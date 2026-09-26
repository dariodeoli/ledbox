"use client";

import { useEffect, useMemo, useState } from "react";
import {
  datePeriodQuery,
  datePeriodRange,
  formatDate,
  formatDateShort,
  formatMoney,
  formatNumber,
  statementAmountLabel,
  statementDirectionLabel,
  statementDirectionTone,
  statementStatusLabel,
  statementStatusTone,
  todayDayKey,
  treasuryDirectionLabel,
  treasuryOriginLabel,
} from "@/lib/admin-format";
import {
  movementSign,
  parseStatementCsv,
  statementMatchCandidates,
  statementRowSign,
  suggestStatementMapping,
  validateStatementMapping,
  EMPTY_STATEMENT_MAPPING,
  STATEMENT_MAX_LIST_ROWS,
  STATEMENT_MAX_CANDIDATES,
  STATEMENT_MATCH_WINDOW_DAYS,
  type StatementCsvMapping,
} from "@/lib/bank-statement";
import type {
  AdminApiResponse,
  AdminBankStatementMovementRef,
  AdminBankStatementRowItem,
  AdminBankStatementSummary,
  AdminTreasuryAccountRow,
} from "@/lib/admin-types";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCsvField,
  AdminDataState,
  AdminDialog,
  AdminEmpty,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
} from "../AdminUI";
import { DateField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { AdminIcon } from "../AdminIcons";

/**
 * Conciliación bancaria (issue #40): sección de `/finanzas`.
 *
 * Importa el extracto del banco (CSV subido o filas pegadas) con mapeo asistido y
 * vista previa real del API, y concilia cada fila contra los movimientos de
 * tesorería de la misma cuenta. Las sugerencias (mismo signo e importe, ±3 días)
 * salen de las reglas puras compartidas con el API; crear el movimiento desde el
 * extracto usa el flujo real de tesorería, con snapshot y auditoría.
 */

const EMPTY_BANK_SUMMARY: AdminBankStatementSummary = {
  rows: 0,
  pending: { count: 0, net: 0 },
  matched: { count: 0, net: 0 },
  ignored: { count: 0, net: 0 },
  bankNet: 0,
  bookNet: 0,
  difference: 0,
};

type BankPayload = {
  rows: AdminBankStatementRowItem[];
  candidates: AdminBankStatementMovementRef[];
  bankSummary: AdminBankStatementSummary;
  statementCount: number;
  statementAccountIds: string[];
  rowsTruncated: boolean;
  candidatesTruncated: boolean;
};

type StatementImportPayload = NonNullable<AdminApiResponse["statementImport"]>;

type StatementNotice = { tone: "ok" | "error"; text: string };

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "Todas las filas" },
  { value: "PENDING", label: "Pendientes" },
  { value: "MATCHED", label: "Conciliadas" },
  { value: "IGNORED", label: "Rechazadas" },
];

/** Máximo de filas del extracto dibujadas en la vista previa del diálogo. */
const PREVIEW_VISIBLE_ROWS = 120;

/** Etiqueta del movimiento candidato: ruta, fecha y hecho de origen. */
function candidateTitle(movement: AdminBankStatementMovementRef): string {
  const route = movement.counterAccount ? `${movement.account.name} → ${movement.counterAccount.name}` : movement.account.name;
  const parts = [
    `${treasuryDirectionLabel(movement.direction)} de ${formatMoney(movement.amount)}`,
    route,
    `Fecha: ${formatDate(movement.occurredAt)}`,
    movement.sourceLabel ? `Origen: ${movement.sourceLabel}` : `Origen: ${treasuryOriginLabel("adjustment")}`,
  ];
  return parts.join(" · ");
}

/** Sugerencia de conciliación para una fila (mismo signo e importe, ±3 días). */
function rowSuggestions(
  row: AdminBankStatementRowItem,
  candidates: readonly AdminBankStatementMovementRef[],
): AdminBankStatementMovementRef[] {
  return statementMatchCandidates(
    { date: row.date, direction: row.direction, amount: row.amount },
    candidates,
    row.account.id,
  );
}

/** Movimientos con el mismo signo e importe en la cuenta, aunque la fecha esté lejos. */
function rowMatchableMovements(
  row: AdminBankStatementRowItem,
  candidates: readonly AdminBankStatementMovementRef[],
): AdminBankStatementMovementRef[] {
  const sign = statementRowSign(row.direction);
  return candidates.filter(
    (movement) => movementSign(movement, row.account.id) === sign && movement.amount === row.amount,
  );
}

export type ConciliacionBancariaProps = {
  accounts: AdminTreasuryAccountRow[];
  /** Cuenta con la que abre la sección (la primera activa del módulo). */
  defaultAccountId: string;
  /** Período compartido del módulo (`DATE_PERIODS`). */
  period: string;
  writable: boolean;
  onNotice: (notice: StatementNotice) => void;
  /** Tesorería cambió (se creó un movimiento): el módulo recarga sus listas. */
  onTreasuryChanged: () => void;
};

export function ConciliacionBancaria({
  accounts,
  defaultAccountId,
  period,
  writable,
  onNotice,
  onTreasuryChanged,
}: ConciliacionBancariaProps) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [status, setStatus] = useState("PENDING");
  const [importOpen, setImportOpen] = useState(false);
  const [dialogRowId, setDialogRowId] = useState("");
  const [busyRowId, setBusyRowId] = useState("");

  const periodQuery = datePeriodQuery(period);
  const path = `/api/admin/bank-statements?accountId=${encodeURIComponent(accountId)}&status=${status}${periodQuery ? `&${periodQuery.slice(1)}` : ""}`;
  const bank = useAdminResource(path, (payload) => ({
    rows: payload.statementRows ?? [],
    candidates: payload.candidates ?? [],
    bankSummary: payload.bankSummary ?? EMPTY_BANK_SUMMARY,
    statementCount: payload.statementCount ?? 0,
    statementAccountIds: payload.statementAccountIds ?? [],
    rowsTruncated: payload.rowsTruncated === true,
    candidatesTruncated: payload.candidatesTruncated === true,
  }));

  const rows = bank.data?.rows ?? [];
  const candidates = bank.data?.candidates ?? [];
  const summary = bank.data?.bankSummary ?? EMPTY_BANK_SUMMARY;
  const statementCount = bank.data?.statementCount ?? 0;
  const periodLabel = period === "all" ? "todo el historial" : "el período";

  // Cuenta por defecto: la primera con extractos importados (la primera activa
  // si todavía no hay ninguno). La primera lectura, sin cuenta, es la que trae
  // las cuentas con extractos.
  useEffect(() => {
    if (accountId) return;
    const withStatements = bank.data?.statementAccountIds ?? [];
    const preferred =
      accounts.find((account) => withStatements.includes(account.id) && account.active)?.id ??
      withStatements[0] ??
      defaultAccountId;
    if (preferred) setAccountId(preferred);
  }, [accountId, accounts, bank.data, defaultAccountId]);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.name} · ${account.active ? "activa" : "inactiva"}`,
      })),
    [accounts],
  );

  /** Fila abierta en el diálogo de conciliación (siempre con datos frescos). */
  const dialogRow = useMemo(() => rows.find((row) => row.id === dialogRowId) ?? null, [rows, dialogRowId]);

  /** Acción sobre una fila del extracto: conciliar, rechazar, deshacer o crear. */
  async function patchRow(
    row: AdminBankStatementRowItem,
    action: "match" | "ignore" | "reset" | "create-movement",
    movementId?: string,
  ) {
    setBusyRowId(row.id);
    const result = await adminSend<{ row?: { status: string }; movement?: { amount: number } }>(
      "/api/admin/bank-statements",
      { action, rowId: row.id, ...(movementId ? { movementId } : {}) },
      "PATCH",
      { idempotencyKey: true },
    );
    setBusyRowId("");
    if (!result.ok) {
      onNotice({ tone: "error", text: result.error });
      return false;
    }
    const text =
      action === "ignore"
        ? `Fila de la línea ${row.line} rechazada: no se concilia y queda fuera de los totales.`
        : action === "reset"
          ? `Fila de la línea ${row.line} volvió a pendiente.`
          : action === "create-movement"
            ? `Movimiento de ${formatMoney(row.amount)} creado desde el extracto y conciliado con la fila.`
            : `Fila de la línea ${row.line} conciliada con el movimiento elegido.`;
    onNotice({ tone: "ok", text });
    setDialogRowId("");
    bank.reload();
    if (action === "create-movement") onTreasuryChanged();
    return true;
  }

  const pendingTone = summary.pending.count > 0 ? "warn" : undefined;
  const differenceTone = summary.difference === 0 ? "ok" : "danger";
  const meta = `${formatNumber(summary.rows)} filas del extracto · ${formatNumber(statementCount)} ${statementCount === 1 ? "extracto importado" : "extractos importados"}`;

  return (
    <AdminPanel
      title="Conciliación bancaria" icon="bank"
      meta={meta}
      action={
        writable ? (
          <AdminButton
            icon="upload"
            onClick={() => setImportOpen((open) => !open)}
            aria-expanded={importOpen}
            title="Importar el extracto del banco (CSV) o pegar sus filas"
          >
            Importar extracto
          </AdminButton>
        ) : null
      }
    >
      {accounts.length === 0 ? (
        <AdminEmpty icon="wallet"
          title="Sin cuentas de tesorería"
          hint="Creá una cuenta (efectivo, banco o cheques) para importar el extracto y conciliarlo contra sus movimientos."
        />
      ) : (
        <>
          <section className="admin-kpis admin-kpis--conciliacion" aria-label="Indicadores de conciliación bancaria">
            <AdminKpi
              label="Pendientes" icon="alert"
              value={formatNumber(summary.pending.count)}
              note={`${formatMoney(summary.pending.net)} netos del extracto`}
              tone={pendingTone}
            />
            <AdminKpi
              label="Conciliadas del período" icon="check"
              value={formatNumber(summary.matched.count)}
              note={`${formatMoney(summary.matched.net)} netos del extracto`}
              tone={summary.matched.count > 0 ? "ok" : undefined}
            />
            <AdminKpi
              label="Diferencia" icon="alert"
              value={formatMoney(summary.difference)}
              note="extracto − movimientos de la cuenta"
              tone={summary.rows > 0 || summary.bookNet !== 0 ? differenceTone : undefined}
            />
          </section>
          <p className="admin-note admin-treasury-formula">
            <span>
              La diferencia es el neto del extracto del período (créditos − débitos, sin las filas rechazadas) menos el
              neto de los movimientos de tesorería de la cuenta en el mismo período. Cero significa conciliado; distinto
              de cero, plata del extracto que no está en los libros (o al revés). <strong>No reescribe el saldo</strong>:
              el disponible de la cuenta sigue saliendo de sus movimientos.
            </span>
          </p>

          <div className="admin-toolbar admin-toolbar--panel">
            <AdminSelect
              value={accountId}
              onChange={setAccountId}
              label="Cuenta de tesorería de la conciliación"
              title="Cuenta cuyo extracto se concilia"
              options={accountOptions}
            />
            <AdminSelect
              value={status}
              onChange={setStatus}
              label="Filtrar las filas del extracto por estado"
              options={STATUS_FILTER_OPTIONS}
            />
            {!writable ? <span className="admin-muted">Solo lectura: tu rol no concilia ni importa extractos.</span> : null}
          </div>

          {bank.data?.rowsTruncated ? (
            <AdminNote>
              El período tiene más de {formatNumber(STATEMENT_MAX_LIST_ROWS)} filas: la lista muestra las últimas. Los KPIs
              se calculan sobre todas.
            </AdminNote>
          ) : null}
          {bank.data?.candidatesTruncated ? (
            <AdminNote>
              La ventana tiene más de {formatNumber(STATEMENT_MAX_CANDIDATES)} movimientos candidatos: algunos no se listan.
              Achicá el período para verlos todos.
            </AdminNote>
          ) : null}

          <AdminDataState
            loading={bank.loading}
            error={bank.error}
            onRetry={bank.reload}
            empty={rows.length === 0}
            emptyTitle={
              status === "PENDING"
                ? "Sin filas pendientes en el período"
                : status === "MATCHED"
                  ? "Sin filas conciliadas en el período"
                  : status === "IGNORED"
                    ? "Sin filas rechazadas en el período"
                    : "Sin extractos importados en el período"
            }
            emptyIcon="bank"
            emptyHint={
              summary.rows > 0
                ? "Probá con otro estado o con «Todas las filas»: hay filas en otros estados."
                : writable
                  ? "Importá el CSV del banco o pegá sus filas para empezar a conciliar."
                  : "Cuando el equipo importe un extracto, las filas aparecen acá."
            }
            rows={4}
          >
            <AdminTable
              view="conciliacion"
              label="Filas del extracto bancario"
              columns={[
                { label: "Fecha" },
                { label: "Descripción" },
                { label: "Referencia" },
                { label: "Tipo" },
                { label: "Monto", end: true },
                { label: "Estado" },
                { label: "Coincidencia" },
                { label: "Acciones", end: true },
              ]}
            >
              {rows.map((row) => {
                const suggestions = rowSuggestions(row, candidates);
                const matchable = rowMatchableMovements(row, candidates);
                const best = suggestions[0] ?? null;
                return (
                  <AdminRow key={row.id} tone={row.status === "PENDING" ? "warn" : undefined}>
                    <AdminCell title={`${formatDate(row.occurredAt)} · ${row.account.name}`}>
                      <span className="admin-nowrap">{formatDateShort(row.occurredAt)}</span>
                    </AdminCell>
                    <AdminCell title={rowTitle(row)}>
                      <strong>{row.description}</strong>
                    </AdminCell>
                    <AdminCell title={row.reference ? `Referencia: ${row.reference}` : "Sin referencia"}>
                      {row.reference ? <span className="admin-code admin-nowrap">{row.reference}</span> : <span className="admin-muted">—</span>}
                    </AdminCell>
                    <AdminCell title={statementDirectionLabel(row.direction)}>
                      <AdminBadge tone={statementDirectionTone(row.direction)}>{statementDirectionLabel(row.direction)}</AdminBadge>
                    </AdminCell>
                    <AdminCell end title={`${statementDirectionLabel(row.direction)} de ${formatMoney(row.amount)} en «${row.account.name}»`}>
                      <span className="admin-nowrap">{statementAmountLabel(row)}</span>
                    </AdminCell>
                    <AdminCell title={matchedTitle(row)}>
                      <AdminBadge tone={statementStatusTone(row.status)}>{statementStatusLabel(row.status)}</AdminBadge>
                    </AdminCell>
                    <AdminCell title={matchTitle(row, suggestions, matchable)}>
                      {row.status === "MATCHED" && row.movement ? (
                        <span className="admin-nowrap">{formatDateShort(row.movement.occurredAt)} · {row.movement.sourceLabel ?? row.movement.account.name}</span>
                      ) : row.status === "IGNORED" ? (
                        <span className="admin-muted">—</span>
                      ) : best ? (
                        <span className="admin-nowrap">{suggestions.length === 1 ? "1 sugerido" : `${formatNumber(suggestions.length)} sugeridos`} · {formatDateShort(best.occurredAt)}</span>
                      ) : matchable.length > 0 ? (
                        <span className="admin-nowrap">{formatNumber(matchable.length)} posible{matchable.length === 1 ? "" : "s"}</span>
                      ) : (
                        <span className="admin-muted">Sin candidato</span>
                      )}
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      <span className="admin-actions">
                        {row.status === "PENDING" && writable ? (
                          <>
                            <AdminButton
                              icon="check"
                              busy={busyRowId === row.id}
                              disabled={Boolean(busyRowId) || !best}
                              title={
                                best
                                  ? `Conciliar con el movimiento del ${formatDate(best.occurredAt)} de ${formatMoney(best.amount)}`
                                  : "Sin movimiento sugerido: elegí otro o creá el movimiento desde el extracto"
                              }
                              aria-label={`Conciliar la fila de la línea ${row.line}`}
                              onClick={() => {
                                if (!best) return;
                                if (suggestions.length === 1) void patchRow(row, "match", best.id);
                                else setDialogRowId(row.id);
                              }}
                            />
                            <AdminButton
                              icon="search"
                              disabled={Boolean(busyRowId)}
                              title="Ver los movimientos candidatos y crear uno desde el extracto"
                              aria-label={`Ver candidatos de la fila de la línea ${row.line}`}
                              onClick={() => setDialogRowId(row.id)}
                            />
                            <AdminButton
                              icon="close"
                              disabled={Boolean(busyRowId)}
                              title="Rechazar la fila: no se concilia y no cuenta en los totales"
                              aria-label={`Rechazar la fila de la línea ${row.line}`}
                              onClick={() => void patchRow(row, "ignore")}
                            />
                          </>
                        ) : null}
                        {row.status === "MATCHED" && writable ? (
                          <AdminButton
                            icon="refresh"
                            busy={busyRowId === row.id}
                            disabled={Boolean(busyRowId)}
                            title={`Deshacer la conciliación${row.matchedByName ? ` hecha por ${row.matchedByName}` : ""}`}
                            aria-label={`Deshacer la conciliación de la línea ${row.line}`}
                            onClick={() => void patchRow(row, "reset")}
                          />
                        ) : null}
                        {row.status === "IGNORED" && writable ? (
                          <AdminButton
                            icon="refresh"
                            busy={busyRowId === row.id}
                            disabled={Boolean(busyRowId)}
                            title="Volver a pendiente: la fila vuelve a la cola de conciliación"
                            aria-label={`Volver a pendiente la fila de la línea ${row.line}`}
                            onClick={() => void patchRow(row, "reset")}
                          />
                        ) : null}
                      </span>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          </AdminDataState>

          {writable && importOpen ? (
            <ImportStatementDialog
              accounts={accounts}
              initialAccountId={accountId || defaultAccountId}
              period={period}
              onClose={() => setImportOpen(false)}
              onImported={(statementLabel, payload) => {
                const imported = payload.total - payload.errors - payload.duplicates;
                onNotice({
                  tone: "ok",
                  text: `Extracto «${statementLabel}» importado: ${formatNumber(imported)} filas${payload.errors > 0 ? ` · ${formatNumber(payload.errors)} con error (no se importaron)` : ""}${payload.duplicates > 0 ? ` · ${formatNumber(payload.duplicates)} duplicadas (ya estaban)` : ""}.`,
                });
                setImportOpen(false);
                bank.reload();
              }}
              onNotice={onNotice}
            />
          ) : null}

          {dialogRow ? (
            <StatementRowDialog
              row={dialogRow}
              suggestions={rowSuggestions(dialogRow, candidates)}
              matchable={rowMatchableMovements(dialogRow, candidates)}
              candidatesTruncated={bank.data?.candidatesTruncated === true}
              accountName={accounts.find((account) => account.id === dialogRow.account.id)?.name ?? dialogRow.account.name}
              busy={busyRowId === dialogRow.id}
              onMatch={(movementId) => void patchRow(dialogRow, "match", movementId)}
              onCreate={() => void patchRow(dialogRow, "create-movement")}
              onClose={() => setDialogRowId("")}
            />
          ) : null}
        </>
      )}
    </AdminPanel>
  );
}

/** Título de la fila del extracto: todos los datos de la traza. */
function rowTitle(row: AdminBankStatementRowItem): string {
  const parts = [
    `Línea ${row.line} del extracto «${row.statement.label}»`,
    `${statementDirectionLabel(row.direction)} de ${formatMoney(row.amount)} en «${row.account.name}»`,
    row.reference ? `Referencia: ${row.reference}` : "Sin referencia",
    `Importado por ${row.statement.importedByName} el ${formatDate(row.statement.createdAt)}`,
  ];
  if (row.raw) parts.push(`Fila original: ${row.raw.slice(0, 160)}`);
  return parts.join(" · ");
}

function matchedTitle(row: AdminBankStatementRowItem): string {
  if (row.status === "MATCHED" && row.matchedAt) {
    return `Conciliada el ${formatDate(row.matchedAt)}${row.matchedByName ? ` por ${row.matchedByName}` : ""}`;
  }
  if (row.status === "IGNORED") return "Rechazada a mano: no se concilia y queda fuera de los totales";
  return "Pendiente de conciliar";
}

function matchTitle(
  row: AdminBankStatementRowItem,
  suggestions: AdminBankStatementMovementRef[],
  matchable: AdminBankStatementMovementRef[],
): string {
  if (row.status === "MATCHED" && row.movement) {
    return `Conciliada con: ${candidateTitle(row.movement)}`;
  }
  if (row.status === "IGNORED") return "Rechazada a mano: no se concilia y queda fuera de los totales";
  if (suggestions.length === 0) {
    return matchable.length > 0
      ? `Hay ${formatNumber(matchable.length)} movimiento(s) del mismo sentido e importe, pero fuera de los ±${STATEMENT_MATCH_WINDOW_DAYS} días.`
      : `Sin movimientos de la misma cuenta, sentido e importe en ±${STATEMENT_MATCH_WINDOW_DAYS} días.`;
  }
  return `Sugerencias: ${suggestions.map((movement) => candidateTitle(movement)).join(" | ")}`;
}

// ── Diálogo de conciliación de una fila ─────────────────────────────────────

function StatementRowDialog({
  row,
  suggestions,
  matchable,
  candidatesTruncated,
  accountName,
  busy,
  onMatch,
  onCreate,
  onClose,
}: {
  row: AdminBankStatementRowItem;
  suggestions: AdminBankStatementMovementRef[];
  matchable: AdminBankStatementMovementRef[];
  candidatesTruncated: boolean;
  accountName: string;
  busy: boolean;
  onMatch: (movementId: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const suggestedIds = useMemo(() => new Set(suggestions.map((movement) => movement.id)), [suggestions]);
  const others = matchable.filter((movement) => !suggestedIds.has(movement.id));
  const direction = row.direction === "DEBIT" ? "OUT" : "IN";

  return (
    <AdminDialog title={`Conciliar la fila ${row.line} del extracto`} size="wide" icon="check" onClose={onClose}>
      <dl className="admin-dialog-facts">
        <div>
          <dt>Fecha</dt>
          <dd>{formatDate(row.occurredAt)}</dd>
        </div>
        <div>
          <dt>Descripción</dt>
          <dd>{row.description}</dd>
        </div>
        <div>
          <dt>Referencia</dt>
          <dd>{row.reference ?? "Sin referencia"}</dd>
        </div>
        <div>
          <dt>Extracto</dt>
          <dd>
            «{row.statement.label}» · línea {row.line} · importado por {row.statement.importedByName}
            {row.statement.originalName ? ` desde ${row.statement.originalName}` : ""}
          </dd>
        </div>
        <div>
          <dt>Movimiento del banco</dt>
          <dd>
            {statementDirectionLabel(row.direction)} de {formatMoney(row.amount)} en «{accountName}»
          </dd>
        </div>
      </dl>

      <h3 className="admin-dialog-title admin-dialog-subtitle">
        <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
          <AdminIcon name="check" size={11} />
        </span>
        Sugerencias de conciliación
      </h3>
      {suggestions.length === 0 ? (
        <AdminNote>
          No hay movimientos de «{accountName}» del mismo sentido y importe con fecha ±{STATEMENT_MATCH_WINDOW_DAYS} días.
          {others.length > 0
            ? ` Hay ${formatNumber(others.length)} movimiento(s) del mismo sentido e importe con la fecha más lejos.`
            : " Podés crear el movimiento desde el extracto para que quede en los libros."}
        </AdminNote>
      ) : (
        <ul className="admin-match-list">
          {suggestions.map((movement) => (
            <li className="admin-match-item" key={movement.id}>
              <span className="admin-match-main">
                <strong>{movement.sourceLabel ?? movement.account.name}</strong>
                <small>{candidateTitle(movement)}</small>
              </span>
              <AdminButton
                icon="check"
                busy={busy}
                disabled={busy}
                onClick={() => onMatch(movement.id)}
                title="Conciliar esta fila con el movimiento"
                aria-label={`Conciliar con el movimiento del ${formatDate(movement.occurredAt)}`}
              >
                Conciliar
              </AdminButton>
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 ? (
        <>
          <h3 className="admin-dialog-title admin-dialog-subtitle">
            <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
              <AdminIcon name="clock" size={11} />
            </span>
            Mismo importe y sentido, otra fecha
          </h3>
          <ul className="admin-match-list">
            {others.slice(0, 12).map((movement) => (
              <li className="admin-match-item" key={movement.id}>
                <span className="admin-match-main">
                  <strong>{movement.sourceLabel ?? movement.account.name}</strong>
                  <small>{candidateTitle(movement)}</small>
                </span>
                <AdminButton
                  icon="check"
                  busy={busy}
                  disabled={busy}
                  onClick={() => onMatch(movement.id)}
                  title="Conciliar esta fila con el movimiento aunque la fecha esté más lejos"
                  aria-label={`Conciliar con el movimiento del ${formatDate(movement.occurredAt)}`}
                >
                  Conciliar
                </AdminButton>
              </li>
            ))}
          </ul>
          {others.length > 12 ? (
            <p className="admin-field-hint">
              Se listan 12 de {formatNumber(others.length)} movimientos con el mismo importe y sentido: achicá el período
              para ver el que buscás.
            </p>
          ) : null}
        </>
      ) : null}

      {candidatesTruncated ? (
        <AdminNote>La ventana tiene más movimientos de los que el panel lista: revisá el período si no encontrás el que buscás.</AdminNote>
      ) : null}

      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton
          icon="plus"
          disabled={busy}
          busy={busy}
          onClick={onCreate}
          title={`Crear ${direction === "IN" ? "una entrada" : "una salida"} de ${formatMoney(row.amount)} en «${accountName}» con el detalle del extracto y conciliarla`}
        >
          Crear movimiento desde el extracto
        </AdminButton>
        <AdminButton icon="close" onClick={onClose} disabled={busy}>
          Cerrar
        </AdminButton>
      </div>
    </AdminDialog>
  );
}

// ── Diálogo de importación del extracto ─────────────────────────────────────

function ImportStatementDialog({
  accounts,
  initialAccountId,
  period,
  onClose,
  onImported,
  onNotice,
}: {
  accounts: AdminTreasuryAccountRow[];
  initialAccountId: string;
  period: string;
  onClose: () => void;
  onImported: (statementLabel: string, payload: StatementImportPayload) => void;
  onNotice: (notice: StatementNotice) => void;
}) {
  const periodRange = datePeriodRange(period);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [periodStart, setPeriodStart] = useState(periodRange?.from ?? `${todayDayKey().slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(periodRange?.to ?? todayDayKey());
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<StatementCsvMapping>({ ...EMPTY_STATEMENT_MAPPING });
  const [header, setHeader] = useState<string[]>([]);
  const [preview, setPreview] = useState<StatementImportPayload | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");

  /** Lee el texto local (archivo o pegado) y precarga el mapeo sugerido. */
  function readText(nextText: string, nextFileName: string | null) {
    setText(nextText);
    setFileName(nextFileName);
    setImportError("");
    setPreviewError("");
    const parsed = parseStatementCsv(nextText);
    const suggested = suggestStatementMapping(parsed.header);
    setHeader(parsed.header);
    setMapping(suggested);
    if (parsed.header.length > 0 && parsed.records.length > 0) {
      void runPreview(nextText, suggested, nextFileName);
    } else {
      setPreview(null);
      setPreviewError("El archivo no tiene filas de datos debajo del encabezado.");
    }
  }

  /** Vista previa real del API: mismas reglas puras y duplicados contra la base. */
  async function runPreview(
    nextText: string,
    nextMapping: StatementCsvMapping,
    nextFileName: string | null = fileName,
    overrides?: { accountId?: string; periodStart?: string; periodEnd?: string },
  ) {
    const account = overrides?.accountId ?? accountId;
    if (!account) {
      setPreviewError("Elegí la cuenta de tesorería del extracto.");
      return;
    }
    setPreviewBusy(true);
    setPreviewError("");
    const result = await adminSend<{ statementImport?: StatementImportPayload }>(
      "/api/admin/bank-statements",
      {
        kind: "preview",
        accountId: account,
        text: nextText,
        mapping: nextMapping,
        periodStart: overrides?.periodStart ?? periodStart,
        periodEnd: overrides?.periodEnd ?? periodEnd,
        originalName: nextFileName ?? undefined,
      },
      "POST",
    );
    setPreviewBusy(false);
    if (!result.ok) {
      setPreview(null);
      setPreviewError(result.error);
      return;
    }
    setPreview(result.data.statementImport ?? null);
  }

  /** Cambio de columna: se revalida la vista previa con el mapeo nuevo. */
  function changeMapping(key: keyof StatementCsvMapping, value: string) {
    const next = { ...mapping, [key]: Number(value) };
    setMapping(next);
    if (text.trim()) void runPreview(text, next);
  }

  /** Cambio de período: la vista previa se revalida con las fechas nuevas. */
  function changePeriod(key: "periodStart" | "periodEnd", value: string) {
    const nextStart = key === "periodStart" ? value : periodStart;
    const nextEnd = key === "periodEnd" ? value : periodEnd;
    if (key === "periodStart") setPeriodStart(value);
    else setPeriodEnd(value);
    if (text.trim() && nextStart && nextEnd) {
      void runPreview(text, mapping, fileName, { periodStart: nextStart, periodEnd: nextEnd });
    }
  }

  async function importStatement() {
    setImportBusy(true);
    setImportError("");
    const result = await adminSend<{ statement?: { label: string }; statementImport?: StatementImportPayload }>(
      "/api/admin/bank-statements",
      {
        kind: "import",
        accountId,
        text,
        mapping,
        periodStart,
        periodEnd,
        label: label.trim() || undefined,
        originalName: fileName ?? undefined,
      },
      "POST",
      { idempotencyKey: true },
    );
    setImportBusy(false);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    onImported(result.data.statement?.label ?? label.trim() ?? "Extracto", result.data.statementImport ?? { rows: [], total: 0, ok: 0, errors: 0, duplicates: 0 });
  }

  const importable = preview ? preview.total - preview.errors - preview.duplicates : 0;
  const mappingError = header.length > 0 ? validateStatementMapping(mapping, header) : null;
  const previewRows = preview?.rows.slice(0, PREVIEW_VISIBLE_ROWS) ?? [];
  const previewErrors = preview?.rows.filter((row) => row.error).slice(0, 8) ?? [];

  return (
    <AdminDialog title="Importar extracto del banco" size="wide" icon="bank" onClose={onClose}>
      <div className="admin-import-grid">
        <SelectField
          label="Cuenta de tesorería"
          required
          hint="La cuenta bancaria a la que pertenece el extracto"
          value={accountId}
          onChange={(value) => {
            setAccountId(value);
            if (text.trim()) void runPreview(text, mapping, fileName, { accountId: value });
          }}
          options={
            accounts.length > 0
              ? accounts.map((account) => ({
                  value: account.id,
                  label: `${account.name} · ${account.type === "BANK" ? "banco" : account.type === "CHEQUE" ? "cheques" : account.type === "CASH" ? "efectivo" : "otra"}`,
                }))
              : [{ value: "", label: "Sin cuentas de tesorería" }]
          }
        />
        <DateField label="Período desde" required value={periodStart} onChange={(value) => changePeriod("periodStart", value)} />
        <DateField label="Período hasta" required value={periodEnd} onChange={(value) => changePeriod("periodEnd", value)} />
        <TextField
          label="Nombre del extracto"
          hint="Opcional: si falta se arma con la cuenta y el período"
          maxLength={120}
          value={label}
          onChange={setLabel}
          placeholder="Ueno Bank · setiembre"
        />
        <AdminCsvField
          label="Archivo CSV"
          hint="CSV o TSV de hasta 512 KB; el texto no sale del navegador hasta que previsualizás"
          fileName={fileName}
          busy={previewBusy}
          onText={(value, name) => readText(value, name)}
        />
        <div className="admin-import-paste">
          <TextAreaField
            label="O pegá las filas"
            hint="La primera fila es el encabezado; también se acepta lo copiado de una planilla"
            rows={4}
            maxLength={512 * 1024}
            value={text}
            onChange={setText}
            placeholder={"Fecha;Descripción;Débito;Crédito\n15/09/2026;Transferencia;1500000;"}
          />
          <AdminButton
            icon="search"
            busy={previewBusy}
            disabled={previewBusy || !text.trim()}
            onClick={() => readText(text, null)}
            title="Analizar las filas pegadas y armar la vista previa"
            aria-label="Analizar las filas pegadas"
          >
            Analizar filas
          </AdminButton>
        </div>
      </div>

      {header.length > 0 ? (
        <div className="admin-import-mapping">
          <h3 className="admin-dialog-title admin-dialog-subtitle">
            <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
              <AdminIcon name="database" size={11} />
            </span>
            Columnas del archivo
          </h3>
          <div className="admin-import-mapping-grid">
            <MappingSelect label="Fecha" value={mapping.date} header={header} onChange={(value) => changeMapping("date", value)} />
            <MappingSelect label="Descripción" value={mapping.description} header={header} onChange={(value) => changeMapping("description", value)} />
            <MappingSelect label="Referencia" value={mapping.reference} header={header} optional onChange={(value) => changeMapping("reference", value)} />
            <MappingSelect label="Débito" value={mapping.debit} header={header} optional onChange={(value) => changeMapping("debit", value)} />
            <MappingSelect label="Crédito" value={mapping.credit} header={header} optional onChange={(value) => changeMapping("credit", value)} />
            <MappingSelect label="Monto (con signo)" value={mapping.amount} header={header} optional onChange={(value) => changeMapping("amount", value)} />
          </div>
          <p className="admin-field-hint">
            Con débito y crédito separados no hace falta el monto; con una sola columna de monto, el signo define el
            sentido (negativo = débito).
          </p>
        </div>
      ) : null}

      {previewError ? <AdminNote tone="error">{previewError}</AdminNote> : null}
      {mappingError ? <AdminNote>{mappingError}</AdminNote> : null}

      {preview ? (
        <>
          <p className="admin-import-counts">
            <strong>{formatNumber(preview.total)} filas leídas</strong> · {formatNumber(importable)} listas para importar
            {preview.errors > 0 ? ` · ${formatNumber(preview.errors)} con error` : ""}
            {preview.duplicates > 0 ? ` · ${formatNumber(preview.duplicates)} duplicadas (ya importadas)` : ""}
          </p>
          {previewRows.length > 0 ? (
            <AdminTable
              view="extracto-preview"
              label="Vista previa del extracto"
              columns={[
                { label: "Línea" },
                { label: "Fecha" },
                { label: "Descripción" },
                { label: "Referencia" },
                { label: "Tipo" },
                { label: "Monto", end: true },
                { label: "Estado" },
              ]}
            >
              {previewRows.map((row) => (
                <AdminRow key={`${row.line}-${row.description}`} tone={row.error ? "danger" : row.duplicate ? "neutral" : undefined}>
                  <AdminCell title={`Línea ${row.line} del archivo`}>
                    <span className="admin-nowrap">{formatNumber(row.line)}</span>
                  </AdminCell>
                  <AdminCell title={row.date ?? "Fecha inválida"}>
                    <span className="admin-nowrap">{formatPreviewDay(row.date)}</span>
                  </AdminCell>
                  <AdminCell title={row.description || "Sin descripción"}>
                    <strong>{row.description || "—"}</strong>
                  </AdminCell>
                  <AdminCell title={row.reference ?? "Sin referencia"}>
                    {row.reference ? <span className="admin-code admin-nowrap">{row.reference}</span> : <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell>
                    {row.direction ? (
                      <AdminBadge tone={statementDirectionTone(row.direction)}>{statementDirectionLabel(row.direction)}</AdminBadge>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </AdminCell>
                  <AdminCell end title={row.amount !== null ? formatMoney(row.amount) : "Sin monto"}>
                    <span className="admin-nowrap">{row.amount !== null ? formatMoney(row.amount) : "—"}</span>
                  </AdminCell>
                  <AdminCell title={row.error ?? (row.duplicate ? "Ya importada en un extracto de esta cuenta" : "Lista para importar")}>
                    {row.error ? (
                      <AdminBadge tone="danger">Con error</AdminBadge>
                    ) : row.duplicate ? (
                      <AdminBadge tone="neutral">Duplicada</AdminBadge>
                    ) : (
                      <AdminBadge tone="ok">Lista</AdminBadge>
                    )}
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          ) : null}
          {preview.total > PREVIEW_VISIBLE_ROWS ? (
            <p className="admin-field-hint">
              La vista previa muestra las primeras {formatNumber(PREVIEW_VISIBLE_ROWS)} filas de {formatNumber(preview.total)}.
            </p>
          ) : null}
          {previewErrors.length > 0 ? (
            <ul className="admin-import-errors">
              {previewErrors.map((row) => (
                <li key={`error-${row.line}`}>
                  <span className="admin-code">Línea {row.line}</span> {row.error}
                </li>
              ))}
              {preview.errors > previewErrors.length ? (
                <li>…y {formatNumber(preview.errors - previewErrors.length)} fila(s) más con error.</li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}

      {importError ? <AdminNote tone="error">{importError}</AdminNote> : null}

      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton
          variant="primary"
          icon="upload"
          busy={importBusy}
          disabled={importBusy || previewBusy || !preview || importable === 0 || Boolean(mappingError)}
          onClick={() => void importStatement()}
          title={
            importable > 0
              ? `Importar ${formatNumber(importable)} filas del extracto`
              : "No hay filas nuevas para importar: revisá los errores y los duplicados"
          }
        >
          Importar {importable > 0 ? formatNumber(importable) : ""} filas
        </AdminButton>
        <AdminButton icon="close" onClick={onClose} disabled={importBusy}>
          Cancelar
        </AdminButton>
      </div>
    </AdminDialog>
  );
}

/** Fecha de la vista previa: la clave `YYYY-MM-DD` se dibuja sin corrimiento. */
function formatPreviewDay(dayKey: string | null): string {
  if (!dayKey) return "—";
  const [year, month, day] = dayKey.split("-");
  return `${day}/${month}/${year}`;
}

/** Selector de una columna del archivo para un rol del mapeo. */
function MappingSelect({
  label,
  value,
  header,
  optional,
  onChange,
}: {
  label: string;
  value: number;
  header: string[];
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <SelectField
      label={label}
      hint={optional ? "Opcional" : undefined}
      value={String(value)}
      onChange={onChange}
      options={[
        { value: "-1", label: optional ? "Sin usar" : "Elegí una columna…" },
        ...header.map((cell, index) => ({
          value: String(index),
          label: `${index + 1}. ${cell || "(sin título)"}`,
        })),
      ]}
    />
  );
}
