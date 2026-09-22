import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  buildStatementPreview,
  movementSign,
  parseStatementCsv,
  statementRowFingerprint,
  validateStatementMapping,
  EMPTY_STATEMENT_MAPPING,
  STATEMENT_CSV_MAX_CHARS,
  STATEMENT_MAX_DESCRIPTION,
  STATEMENT_MAX_REFERENCE,
  STATEMENT_MAX_ROWS,
  STATEMENT_MAX_LIST_ROWS,
  STATEMENT_MAX_CANDIDATES,
  STATEMENT_ROW_STATUSES,
  type ParsedStatementCsv,
  type ParsedStatementRow,
  type StatementCsvMapping,
  type StatementRowStatusValue,
} from "@/lib/bank-statement";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { withIdempotency } from "@/lib/server/idempotency";
import { movementSourceSnapshot, parseMovementSourceSnapshot } from "@/lib/server/finance-snapshots";
import { dayKeyOf, dayStart, isValidDayKey, shiftDayKey } from "@/lib/server/notifications";
import { MAX_SOURCE_LABEL, resolveSourceLabels } from "@/lib/server/treasury-labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conciliación bancaria (issue #40).
 *
 * - `GET` devuelve las filas del extracto de la cuenta elegida con su estado, los
 *   movimientos de tesorería **sin conciliar** que sirven de candidatos (misma
 *   cuenta y ventana cercana a las filas) y los KPIs del período. El neto del
 *   extracto (sin las filas rechazadas) se compara contra el neto de los
 *   movimientos y la diferencia queda a la vista; el saldo de la cuenta sigue
 *   siendo el derivado de tesorería, el extracto no lo reescribe.
 * - `POST` con `kind: "preview"` lee el CSV pegado o subido con las mismas reglas
 *   puras que el cliente (mapeo, fechas, montos y errores por fila) y marca los
 *   duplicados contra lo ya importado, sin escribir nada. Con `kind: "import"`
 *   revalida todo dentro de una transacción idempotente, crea el extracto y sus
 *   filas válidas (los errores y duplicados no se importan) y audita con el actor
 *   real; requiere `finance.write`.
 * - `PATCH` concilia una fila con un movimiento real (misma cuenta, mismo sentido
 *   y mismo importe), la rechaza, la vuelve a pendiente o crea el movimiento
 *   desde la fila con el flujo real de tesorería (ajuste con snapshot del
 *   extracto y match 1 a 1 con la fila). Todo auditado y aislado por empresa:
 *   una fila o cuenta ajena responde 404.
 */

const MAX_LABEL = 120;
const MAX_FILE_NAME = 160;

/** Ventana de los candidatos alrededor de las filas: más ancha que las sugerencias. */
const CANDIDATE_WINDOW_DAYS = 30;

const accountSelect = { id: true, name: true, type: true } as const;

const movementSelect = {
  id: true,
  accountId: true,
  counterAccountId: true,
  direction: true,
  amount: true,
  occurredAt: true,
  origin: true,
  sourceId: true,
  sourceSnapshot: true,
  account: { select: accountSelect },
  counterAccount: { select: accountSelect },
} as const;

type MovementRow = Prisma.TreasuryMovementGetPayload<{ select: typeof movementSelect }>;
type StatementTransaction = Prisma.TransactionClient | typeof db;

/** Día de Asunción pedido en el body; `undefined` si no vino y `null` si es inválido. */
function readDayKey(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  const key = raw.trim().slice(0, 10);
  return isValidDayKey(key) ? key : null;
}

/** Rango de días de Asunción del filtro `from`/`to` (ambos inclusive). */
function dayRange(params: URLSearchParams): { from?: Date; to?: Date } | null {
  const from = (params.get("from") ?? "").trim();
  const to = (params.get("to") ?? "").trim();
  const range: { from?: Date; to?: Date } = {};
  if (from) {
    if (!isValidDayKey(from)) return null;
    range.from = dayStart(from);
  }
  if (to) {
    if (!isValidDayKey(to)) return null;
    range.to = dayStart(shiftDayKey(to, 1));
  }
  return range;
}

function dayRangeFilter(range: { from?: Date; to?: Date }): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) return undefined;
  return { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) };
}

/** Mapeo de columnas del body; `null` si trae índices que no son números. */
function readMapping(raw: unknown): StatementCsvMapping | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const mapping = { ...EMPTY_STATEMENT_MAPPING };
  for (const key of Object.keys(mapping) as Array<keyof StatementCsvMapping>) {
    const value = source[key];
    if (value === undefined || value === null || value === "") continue;
    const index = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(index) || index < -1 || index > 200) return null;
    mapping[key] = index;
  }
  return mapping;
}

/** Huella de una fila ya válida; `null` cuando la fila no llegó a normalizarse. */
function fingerprintOf(row: ParsedStatementRow): string | null {
  if (row.error || !row.date || !row.direction || row.amount === null) return null;
  return statementRowFingerprint({
    date: row.date,
    direction: row.direction,
    amount: row.amount,
    description: row.description,
    reference: row.reference,
  });
}

type StatementInput = {
  accountId: string;
  csv: ParsedStatementCsv;
  preview: ReturnType<typeof buildStatementPreview>;
  label: string;
  originalName: string | null;
  periodStartKey: string;
  periodEndKey: string;
};

/** Lee y valida el cuerpo del extracto (mismo parser puro que usa la vista previa). */
function readStatementInput(body: Record<string, unknown>): { ok: true; input: StatementInput } | { ok: false; error: string } {
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!accountId) return { ok: false, error: "Elegí la cuenta de tesorería del extracto." };
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return { ok: false, error: "Subí el CSV del banco o pegá las filas." };
  if (text.length > STATEMENT_CSV_MAX_CHARS) {
    return { ok: false, error: "El archivo es demasiado grande (máximo 512 KB): dividí el extracto por período." };
  }
  const mapping = readMapping(body.mapping);
  if (!mapping) return { ok: false, error: "El mapeo de columnas no es válido: volvé a elegir las columnas." };
  const csv = parseStatementCsv(text);
  if (csv.header.length === 0 || csv.records.length === 0) {
    return { ok: false, error: "El archivo no tiene filas de datos debajo del encabezado." };
  }
  if (csv.records.length > STATEMENT_MAX_ROWS) {
    return { ok: false, error: `El archivo tiene ${csv.records.length} filas: el máximo por importación es ${STATEMENT_MAX_ROWS}.` };
  }
  const mappingError = validateStatementMapping(mapping, csv.header);
  if (mappingError) return { ok: false, error: mappingError };
  const periodStartKey = readDayKey(body.periodStart);
  if (!periodStartKey) return { ok: false, error: "El período del extracto tiene que empezar en una fecha válida." };
  const periodEndKey = readDayKey(body.periodEnd);
  if (!periodEndKey) return { ok: false, error: "El período del extracto tiene que terminar en una fecha válida." };
  if (periodEndKey < periodStartKey) return { ok: false, error: "El período del extracto termina antes de empezar." };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, MAX_LABEL) : "";
  const originalName = typeof body.originalName === "string" ? body.originalName.trim().slice(0, MAX_FILE_NAME) : "";
  const preview = buildStatementPreview(csv, mapping);
  return {
    ok: true,
    input: {
      accountId,
      csv,
      preview,
      label: label || `Extracto ${periodStartKey} → ${periodEndKey}`,
      originalName: originalName || null,
      periodStartKey,
      periodEndKey,
    },
  };
}

/** Huellas de las filas válidas del archivo (para detectar duplicados ya importados). */
function fingerprintsOf(rows: readonly ParsedStatementRow[]): string[] {
  return [...new Set(rows.map(fingerprintOf).filter((value): value is string => Boolean(value)))];
}

async function existingFingerprints(
  tx: StatementTransaction,
  organizationId: string,
  accountId: string,
  fingerprints: readonly string[],
): Promise<Set<string>> {
  if (fingerprints.length === 0) return new Set();
  const rows = await tx.bankStatementRow.findMany({
    where: { organizationId, accountId, fingerprint: { in: [...fingerprints] } },
    select: { fingerprint: true },
  });
  return new Set(rows.map((row) => row.fingerprint));
}

/** Fila del extracto lista para el panel, con la marca de duplicado aplicada. */
function serializeImportRow(row: ParsedStatementRow, duplicates: Set<string>) {
  const fingerprint = fingerprintOf(row);
  return {
    line: row.line,
    date: row.date,
    description: row.description,
    reference: row.reference,
    direction: row.direction,
    amount: row.amount,
    error: row.error,
    duplicate: fingerprint ? duplicates.has(fingerprint) : false,
  };
}

async function statementPreviewPayload(tx: StatementTransaction, organizationId: string, input: StatementInput) {
  const duplicates = await existingFingerprints(tx, organizationId, input.accountId, fingerprintsOf(input.preview.rows));
  const rows = input.preview.rows.map((row) => serializeImportRow(row, duplicates));
  return {
    rows,
    total: input.preview.total,
    ok: input.preview.ok,
    errors: input.preview.errors,
    duplicates: rows.filter((row) => row.duplicate).length,
  };
}

function movementRef(movement: MovementRow, liveLabels: Map<string, string>) {
  const snapshot = parseMovementSourceSnapshot(movement.sourceSnapshot);
  const live = movement.sourceId ? liveLabels.get(`${movement.origin}:${movement.sourceId}`) : null;
  const label = snapshot?.label ?? live ?? null;
  return {
    id: movement.id,
    direction: movement.direction,
    amount: movement.amount,
    occurredAt: movement.occurredAt.toISOString(),
    accountId: movement.accountId,
    counterAccountId: movement.counterAccountId,
    account: movement.account,
    counterAccount: movement.counterAccount,
    sourceLabel: label ? label.slice(0, MAX_SOURCE_LABEL) : null,
  };
}

/** Días extremos (el más viejo y el más nuevo) de las filas devueltas. */
function daySpanOf(rows: ReadonlyArray<{ date: Date }>): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const row of rows) {
    const key = dayKeyOf(row.date);
    if (!from || key < from) from = key;
    if (!to || key > to) to = key;
  }
  return from && to ? { from, to } : null;
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const params = new URL(request.url).searchParams;
  const range = dayRange(params);
  if (!range) return jsonError("El período tiene que estar en días válidos (AAAA-MM-DD).", 400);
  const accountId = (params.get("accountId") ?? "").trim();
  const statusRaw = (params.get("status") ?? "").trim().toUpperCase();
  if (statusRaw && !(STATEMENT_ROW_STATUSES as readonly string[]).includes(statusRaw)) {
    return jsonError("El estado de la fila es PENDING, MATCHED o IGNORED.", 400);
  }
  const dateFilter = dayRangeFilter(range);

  const account = accountId
    ? await db.treasuryAccount.findFirst({ where: { id: accountId, organizationId }, select: accountSelect })
    : null;
  if (accountId && !account) return jsonError("La cuenta no existe en esta empresa.", 404);

  const [statementRows, statementCount, statementAccounts, grouped, linkedRows] = await Promise.all([
    db.bankStatementRow.findMany({
      where: {
        organizationId,
        ...(account ? { accountId: account.id } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
        ...(statusRaw ? { status: statusRaw as StatementRowStatusValue } : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: STATEMENT_MAX_LIST_ROWS + 1,
      include: {
        statement: { select: { id: true, label: true, originalName: true, importedByName: true, createdAt: true } },
        account: { select: accountSelect },
        movement: { select: movementSelect },
      },
    }),
    db.bankStatement.count({
      where: { organizationId, ...(account ? { accountId: account.id } : {}) },
    }),
    // Cuentas que ya tienen extractos importados: el panel abre en la primera
    // que tenga datos en vez de una cuenta cualquiera.
    db.bankStatement.groupBy({ by: ["accountId"], where: { organizationId } }),
    // Conteo y neto por estado sobre TODAS las filas del período (la lista puede
    // recortarse; los KPIs no).
    db.bankStatementRow.groupBy({
      by: ["status", "direction"],
      where: {
        organizationId,
        ...(account ? { accountId: account.id } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.bankStatementRow.findMany({
      where: { organizationId, movementId: { not: null } },
      select: { movementId: true },
    }),
  ]);

  const visibleRows = statementRows.slice(0, STATEMENT_MAX_LIST_ROWS);
  const span = daySpanOf(visibleRows);
  const candidateRows = account && span
    ? await db.treasuryMovement.findMany({
        where: {
          organizationId,
          OR: [{ accountId: account.id }, { counterAccountId: account.id }],
          occurredAt: {
            gte: dayStart(shiftDayKey(span.from, -CANDIDATE_WINDOW_DAYS)),
            lt: dayStart(shiftDayKey(span.to, CANDIDATE_WINDOW_DAYS + 1)),
          },
        },
        orderBy: { occurredAt: "desc" },
        take: STATEMENT_MAX_CANDIDATES + 1,
        select: movementSelect,
      })
    : [];

  const liveLabels = await resolveSourceLabels(organizationId, [
    ...visibleRows.map((row) => row.movement).filter((movement): movement is MovementRow => Boolean(movement)),
    ...candidateRows,
  ]);
  const linkedIds = new Set(linkedRows.map((row) => row.movementId as string));

  const rows = visibleRows.map((row) => ({
    id: row.id,
    line: row.line,
    date: dayKeyOf(row.date),
    occurredAt: row.date.toISOString(),
    description: row.description,
    reference: row.reference,
    direction: row.direction,
    amount: row.amount,
    status: row.status,
    raw: row.raw,
    matchedAt: row.matchedAt?.toISOString() ?? null,
    matchedByName: row.matchedByName,
    matchedByEmail: row.matchedByEmail,
    statement: {
      id: row.statement.id,
      label: row.statement.label,
      originalName: row.statement.originalName,
      importedByName: row.statement.importedByName,
      createdAt: row.statement.createdAt.toISOString(),
    },
    account: row.account,
    movement: row.movement ? movementRef(row.movement, liveLabels) : null,
  }));

  /** Conteo y neto (créditos − débitos) de las filas agrupadas por estado. */
  function totalsOf(status: StatementRowStatusValue) {
    let count = 0;
    let net = 0;
    for (const group of grouped) {
      if (group.status !== status) continue;
      const amount = group._sum.amount ?? 0;
      count += group._count._all;
      net += group.direction === "CREDIT" ? amount : -amount;
    }
    return { count, net };
  }

  const pending = totalsOf("PENDING");
  const matched = totalsOf("MATCHED");
  const ignored = totalsOf("IGNORED");
  const bankNet = pending.net + matched.net;

  let bookNet = 0;
  if (account) {
    const [outgoing, incoming] = await Promise.all([
      db.treasuryMovement.groupBy({
        by: ["direction"],
        where: { organizationId, accountId: account.id, ...(dateFilter ? { occurredAt: dateFilter } : {}) },
        _sum: { amount: true },
      }),
      db.treasuryMovement.groupBy({
        by: ["direction"],
        where: { organizationId, counterAccountId: account.id, ...(dateFilter ? { occurredAt: dateFilter } : {}) },
        _sum: { amount: true },
      }),
    ]);
    for (const group of outgoing) {
      const amount = group._sum.amount ?? 0;
      bookNet += group.direction === "IN" ? amount : -amount;
    }
    for (const group of incoming) bookNet += group._sum.amount ?? 0;
  }

  return Response.json({
    statementCount,
    statementAccountIds: statementAccounts.map((row) => row.accountId),
    rowsTruncated: statementRows.length > STATEMENT_MAX_LIST_ROWS,
    statementRows: rows,
    candidates: candidateRows.filter((movement) => !linkedIds.has(movement.id)).map((movement) => movementRef(movement, liveLabels)),
    candidatesTruncated: candidateRows.length > STATEMENT_MAX_CANDIDATES,
    bankSummary: {
      rows: pending.count + matched.count,
      pending,
      matched,
      ignored,
      bankNet,
      bookNet,
      difference: bankNet - bookNet,
    },
  });
}

export async function POST(request: Request) {
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (kind !== "preview" && kind !== "import") return jsonError("Unknown bank statement entry.", 400);
  const parsed = readStatementInput(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const { input } = parsed;

  // La vista previa no escribe: cualquier miembro de la empresa revisa el archivo.
  if (kind === "preview") {
    const auth = await requireAdminContext();
    if (!auth.ok) return auth.response;
    const account = await db.treasuryAccount.findFirst({
      where: { id: input.accountId, organizationId: auth.context.organizationId },
      select: accountSelect,
    });
    if (!account) return jsonError("La cuenta no existe en esta empresa.", 404);
    return Response.json({ statementImport: await statementPreviewPayload(db, auth.context.organizationId, input) });
  }

  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;

  return withIdempotency({ request, organizationId, scope: "bank-statements:POST:import", body }, async (tx) => {
    const account = await tx.treasuryAccount.findFirst({
      where: { id: input.accountId, organizationId },
      select: accountSelect,
    });
    if (!account) return jsonError("La cuenta no existe en esta empresa.", 404);

    const payload = await statementPreviewPayload(tx, organizationId, input);
    const duplicates = new Set(payload.rows.filter((row) => row.duplicate).map((row) => row.line));
    const importable = input.preview.rows.filter((row) => !row.error && !duplicates.has(row.line));
    if (importable.length === 0) {
      return jsonError("No hay filas nuevas para importar: revisá los errores y los duplicados.", 400);
    }

    const statementId = randomUUID();
    const statement = await tx.bankStatement.create({
      data: {
        id: statementId,
        organizationId,
        accountId: account.id,
        label: input.label,
        periodStart: dayStart(input.periodStartKey),
        periodEnd: dayStart(input.periodEndKey),
        originalName: input.originalName,
        lineCount: input.preview.total,
        rowCount: importable.length,
        errorCount: input.preview.errors,
        duplicateCount: payload.duplicates,
        importedById: user.id,
        importedByName: user.name,
        importedByEmail: user.email,
      },
    });
    await tx.bankStatementRow.createMany({
      data: importable.map((row) => ({
        id: randomUUID(),
        statementId,
        organizationId,
        accountId: account.id,
        line: row.line,
        date: dayStart(row.date as string),
        description: (row.description || "Sin descripción").slice(0, STATEMENT_MAX_DESCRIPTION),
        reference: row.reference ? row.reference.slice(0, STATEMENT_MAX_REFERENCE) : null,
        direction: row.direction as "DEBIT" | "CREDIT",
        amount: row.amount as number,
        status: "PENDING" as const,
        fingerprint: fingerprintOf(row) ?? "",
        raw: row.raw.slice(0, 1000),
      })),
    });

    return {
      status: 201,
      body: {
        statement: {
          id: statement.id,
          label: statement.label,
          account,
          periodStart: statement.periodStart.toISOString(),
          periodEnd: statement.periodEnd.toISOString(),
          originalName: statement.originalName,
          lineCount: statement.lineCount,
          rowCount: statement.rowCount,
          errorCount: statement.errorCount,
          duplicateCount: statement.duplicateCount,
          importedByName: statement.importedByName,
          createdAt: statement.createdAt.toISOString(),
        },
        statementImport: payload,
      },
      afterCommit: () =>
        recordAudit({
          context: auth.context,
          action: "create",
          entity: "BankStatement",
          entityId: statement.id,
          summary: `Importó el extracto «${statement.label}» de «${account.name}» · ${importable.length} filas`,
          detail: {
            fields: {
              accountId: account.id,
              label: statement.label,
              periodStart: statement.periodStart.toISOString(),
              periodEnd: statement.periodEnd.toISOString(),
              originalName: statement.originalName,
              lineCount: statement.lineCount,
              rowCount: statement.rowCount,
              errorCount: statement.errorCount,
              duplicateCount: statement.duplicateCount,
            },
          },
        }),
    };
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "match" && action !== "ignore" && action !== "reset" && action !== "create-movement") {
    return jsonError("Unknown bank statement action.", 400);
  }
  const rowId = typeof body.rowId === "string" ? body.rowId.trim() : "";
  if (!rowId) return jsonError("Falta la fila del extracto.", 400);

  return withIdempotency({ request, organizationId, scope: `bank-statements:PATCH:${action}`, body }, async (tx) => {
    const row = await tx.bankStatementRow.findFirst({
      where: { id: rowId, organizationId },
      include: { statement: { select: { id: true, label: true } } },
    });
    if (!row) return jsonError("La fila del extracto no existe en esta empresa.", 404);
    const rowLabel = `«${row.description.slice(0, 80)}» (línea ${row.line})`;

    // ── Conciliar con un movimiento real ─────────────────────────────────────
    if (action === "match") {
      const movementId = typeof body.movementId === "string" ? body.movementId.trim() : "";
      if (!movementId) return jsonError("Elegí el movimiento de tesorería.", 400);
      if (row.status !== "PENDING") return jsonError("La fila ya no está pendiente: recargá la lista.", 409);
      const movement = await tx.treasuryMovement.findFirst({
        where: { id: movementId, organizationId },
        select: movementSelect,
      });
      if (!movement) return jsonError("El movimiento no existe en esta empresa.", 404);
      const expectedSign = row.direction === "DEBIT" ? -1 : 1;
      const matches =
        movement.accountId === row.accountId || movement.counterAccountId === row.accountId
          ? movementSign(movement, row.accountId) === expectedSign && movement.amount === row.amount
          : false;
      if (!matches) {
        return jsonError("El movimiento no coincide: tiene que ser de la misma cuenta, del mismo sentido y por el mismo importe.", 400);
      }
      const alreadyLinked = await tx.bankStatementRow.findFirst({
        where: { organizationId, movementId: movement.id, id: { not: row.id } },
        select: { id: true },
      });
      if (alreadyLinked) return jsonError("Ese movimiento ya está conciliado con otra fila del extracto.", 409);

      const matchedAt = new Date();
      const updated = await tx.bankStatementRow.update({
        where: { id: row.id },
        data: {
          status: "MATCHED",
          movementId: movement.id,
          matchedAt,
          matchedById: user.id,
          matchedByName: user.name,
          matchedByEmail: user.email,
        },
      });
      return {
        status: 200,
        body: {
          row: {
            id: updated.id,
            status: updated.status,
            movementId: updated.movementId,
            matchedAt: matchedAt.toISOString(),
            matchedByName: updated.matchedByName,
          },
        },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "update",
            entity: "BankStatementRow",
            entityId: row.id,
            summary: `Concilió la fila ${rowLabel} del extracto «${row.statement.label}» con un movimiento de tesorería`,
            detail: {
              changes: {
                status: { from: "PENDING", to: "MATCHED" },
                movementId: { from: null, to: movement.id },
              },
              fields: {
                statementId: row.statement.id,
                accountId: row.accountId,
                amount: row.amount,
                direction: row.direction,
              },
            },
          }),
      };
    }

    // ── Crear el movimiento desde el extracto ────────────────────────────────
    if (action === "create-movement") {
      if (row.status !== "PENDING") return jsonError("La fila ya no está pendiente: recargá la lista.", 409);
      const direction = row.direction === "DEBIT" ? "OUT" : "IN";
      const movement = await tx.treasuryMovement.create({
        data: {
          id: randomUUID(),
          organizationId,
          accountId: row.accountId,
          counterAccountId: null,
          direction,
          amount: row.amount,
          occurredAt: row.date,
          origin: "adjustment",
          sourceId: row.id,
          sourceSnapshot: movementSourceSnapshot({
            kind: "bank_statement",
            label: row.description,
            amount: row.amount,
            ref: row.reference,
          }),
          notes: `Extracto «${row.statement.label}» · línea ${row.line}`,
          createdById: user.id,
          createdByName: user.name,
          createdByEmail: user.email,
        },
        select: movementSelect,
      });
      const updated = await tx.bankStatementRow.update({
        where: { id: row.id },
        data: {
          status: "MATCHED",
          movementId: movement.id,
          matchedAt: new Date(),
          matchedById: user.id,
          matchedByName: user.name,
          matchedByEmail: user.email,
        },
      });
      return {
        status: 201,
        body: {
          row: {
            id: updated.id,
            status: updated.status,
            movementId: updated.movementId,
            matchedAt: updated.matchedAt?.toISOString() ?? null,
            matchedByName: updated.matchedByName,
          },
          movement: {
            id: movement.id,
            direction: movement.direction,
            amount: movement.amount,
            occurredAt: movement.occurredAt.toISOString(),
            account: movement.account,
          },
        },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "create",
            entity: "TreasuryMovement",
            entityId: movement.id,
            summary: `Creó el movimiento de tesorería desde el extracto «${row.statement.label}» · ${rowLabel}`,
            detail: {
              fields: {
                direction,
                amount: row.amount,
                occurredAt: row.date.toISOString(),
                accountId: row.accountId,
                origin: "adjustment",
                statementId: row.statement.id,
                statementRowId: row.id,
                reference: row.reference,
              },
            },
          }),
      };
    }

    // ── Rechazar o volver a pendiente ────────────────────────────────────────
    if (action === "ignore") {
      if (row.status !== "PENDING") return jsonError("Solo se rechaza una fila pendiente: recargá la lista.", 409);
      const updated = await tx.bankStatementRow.update({ where: { id: row.id }, data: { status: "IGNORED" } });
      return {
        status: 200,
        body: { row: { id: updated.id, status: updated.status } },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "status",
            entity: "BankStatementRow",
            entityId: row.id,
            summary: `Rechazó la fila ${rowLabel} del extracto «${row.statement.label}»`,
            detail: {
              changes: { status: { from: "PENDING", to: "IGNORED" } },
              fields: { statementId: row.statement.id, accountId: row.accountId },
            },
          }),
      };
    }

    if (row.status === "PENDING") return jsonError("La fila ya está pendiente.", 409);
    const previousStatus = row.status;
    const updated = await tx.bankStatementRow.update({
      where: { id: row.id },
      data: { status: "PENDING", movementId: null, matchedAt: null, matchedById: null, matchedByName: null, matchedByEmail: null },
    });
    return {
      status: 200,
      body: { row: { id: updated.id, status: updated.status } },
      afterCommit: () =>
        recordAudit({
          context: auth.context,
          action: "status",
          entity: "BankStatementRow",
          entityId: row.id,
          summary:
            previousStatus === "MATCHED"
              ? `Deshizo la conciliación de la fila ${rowLabel} del extracto «${row.statement.label}»`
              : `Devolvió a pendiente la fila ${rowLabel} del extracto «${row.statement.label}»`,
          detail: {
            changes: { status: { from: previousStatus, to: "PENDING" }, movementId: { from: row.movementId, to: null } },
            fields: { statementId: row.statement.id, accountId: row.accountId },
          },
        }),
    };
  });
}
