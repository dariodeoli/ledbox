import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { AUDIT_ACTIONS } from "../lib/admin-types";
import { ADMIN_ROLES, roleCan } from "../lib/server/permissions";
import { FILTERED_OPERATIONS, live, mentionsDeletedAt, TRASH_MODELS, withLiveFilter } from "../lib/server/trash-filter";
import { blockedError, blockersFor, blockersMessage, TrashError } from "../lib/server/trash";

const root = join(import.meta.dirname, "..");

test("el filtro agrega deletedAt:null y respeta un where explícito", () => {
  assert.deepEqual(withLiveFilter({ where: { organizationId: "o1" } }), { where: { organizationId: "o1", deletedAt: null } });
  assert.deepEqual(withLiveFilter(undefined), { where: { deletedAt: null } });
  assert.deepEqual(withLiveFilter({ where: undefined, ...{ take: 5 } } as { where?: unknown }), { take: 5, where: { deletedAt: null } });
  // findUnique conserva la clave única en el nivel superior.
  assert.deepEqual(withLiveFilter({ where: { id: "x" } }), { where: { id: "x", deletedAt: null } });
  // El where explícito (también anidado en AND/OR/NOT) se respeta sin tocar.
  const explicit = { where: { organizationId: "o1", deletedAt: { not: null } } };
  assert.equal(withLiveFilter(explicit), explicit);
  const nested = { where: { AND: [{ organizationId: "o1" }, { deletedAt: { not: null } }] } };
  assert.equal(withLiveFilter(nested), nested, "una mención dentro de AND se respeta");
  const inOr = { where: { OR: [{ deletedAt: null }, { deletedAt: { gt: new Date(0) } }] } };
  assert.equal(mentionsDeletedAt(inOr.where), false, "dentro de OR no cuenta");
  assert.deepEqual(withLiveFilter(inOr).where, { OR: inOr.where.OR, deletedAt: null }, "con deletedAt solo en un OR igual se agrega el filtro de nivel superior");
  const inNot = { where: { NOT: { deletedAt: null } } };
  assert.deepEqual(withLiveFilter(inNot).where, { NOT: { deletedAt: null }, deletedAt: null });
  const undef = { where: { id: "x", deletedAt: undefined } };
  assert.equal(withLiveFilter(undef), undef, "deletedAt:undefined cuenta como mención (lo usan los bloqueos)");
  assert.equal(mentionsDeletedAt({ organizationId: "o" }), false);
  assert.deepEqual(live, { deletedAt: null });
  assert.deepEqual([...FILTERED_OPERATIONS].sort(), ["aggregate", "count", "findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "groupBy"]);
  assert.equal(TRASH_MODELS.length, 7);
});

test("db.ts cablea la extensión sobre los 7 modelos y exporta dbWithDeleted", () => {
  const source = readFileSync(join(root, "lib/server/db.ts"), "utf8");
  assert.match(source, /export const dbWithDeleted/);
  assert.match(source, /export const db: PrismaClient/);
  assert.match(source, /withLiveFilter/);
  assert.match(source, /isTrashModel\(model\)/);
});

test("trash.manage es solo de OWNER y ADMIN; las auditorías nuevas existen", () => {
  for (const role of ADMIN_ROLES) assert.equal(roleCan(role, "trash.manage"), role === "OWNER" || role === "ADMIN", role);
  for (const action of ["archive", "restore", "trash", "purge", "anonymize"]) assert.ok((AUDIT_ACTIONS as readonly string[]).includes(action), action);
});

/** tx falso: responde los `_count` configurados y registra el bloqueo FOR UPDATE. */
function fakeTx(counts: Record<string, Record<string, number>>, extra: Record<string, number> = {}) {
  const locked: string[] = [];
  const row = (model: string) => ({ findFirst: async () => ({ _count: counts[model] ?? {} }) });
  const tx = {
    $queryRawUnsafe: async (sql: string) => {
      locked.push(sql);
      return [{ id: "x" }];
    },
    event: { ...row("event"), count: async () => extra.eventsWithPayments ?? 0 },
    inventoryItem: row("inventoryItem"),
    supplier: row("supplier"),
    promoter: row("promoter"),
    lead: row("lead"),
    budget: { ...row("budget"), count: async (args: { where: { status?: string; signatureRequests?: unknown } }) => (args.where.status ? extra.approved ?? 0 : extra.signed ?? 0) },
    clientPayment: { count: async () => extra.payments ?? 0 },
    invoice: { count: async () => extra.invoices ?? 0 },
  };
  return { tx: tx as never, locked };
}

test("blockersFor devuelve el bloqueo de cada FK del diseño y bloquea la fila", async () => {
  let r = fakeTx({ event: { invoices: 2, expenses: 1, supplierJobs: 3, incidents: 4 } }, { payments: 5 });
  assert.deepEqual(await blockersFor("Event", "e1", "o1", r.tx), [
    { kind: "invoices", count: 2 }, { kind: "expenses", count: 1 }, { kind: "supplierJobs", count: 3 }, { kind: "incidents", count: 4 }, { kind: "payments", count: 5 },
  ]);
  assert.match(r.locked[0], /FOR UPDATE/);
  assert.match(r.locked[0], /"organizationId"/);

  r = fakeTx({ inventoryItem: { assignments: 1, incidents: 2, usedInCombos: 3 } });
  assert.deepEqual(await blockersFor("InventoryItem", "i1", "o1", r.tx), [{ kind: "assignments", count: 1 }, { kind: "incidents", count: 2 }, { kind: "usedInCombos", count: 3 }]);

  r = fakeTx({ supplier: { jobs: 1, expenses: 2, purchaseInvoices: 3 } });
  assert.deepEqual(await blockersFor("Supplier", "s1", "o1", r.tx), [{ kind: "supplierJobs", count: 1 }, { kind: "expenses", count: 2 }, { kind: "purchaseInvoices", count: 3 }]);

  r = fakeTx({ promoter: { tasks: 2 } });
  assert.deepEqual(await blockersFor("Promoter", "p1", "o1", r.tx), [{ kind: "tasks", count: 2 }]);

  r = fakeTx({ lead: { budgets: 1 } });
  assert.deepEqual(await blockersFor("Lead", "l1", "o1", r.tx), [{ kind: "budgets", count: 1 }]);

  r = fakeTx({ budget: { signatureRequests: 1, payments: 2, paymentProofs: 3, invoices: 4, expectedPayments: 5 } });
  assert.deepEqual(await blockersFor("Budget", "b1", "o1", r.tx), [
    { kind: "signatureRequests", count: 1 }, { kind: "payments", count: 2 }, { kind: "paymentProofs", count: 3 }, { kind: "confirmedExpectedPayments", count: 5 }, { kind: "invoices", count: 4 },
  ]);

  r = fakeTx({}, { approved: 1, signed: 2, payments: 3, invoices: 4, eventsWithPayments: 5 });
  assert.deepEqual(await blockersFor("Client", "c1", "o1", r.tx), [
    { kind: "approvedBudgets", count: 1 }, { kind: "signedBudgets", count: 2 }, { kind: "payments", count: 3 }, { kind: "invoices", count: 4 }, { kind: "eventsWithPayments", count: 5 },
  ]);

  r = fakeTx({});
  assert.deepEqual(await blockersFor("Lead", "l1", "o1", r.tx), []);
});

test("blockersFor responde 404 si la fila no es de la empresa", async () => {
  const tx = { $queryRawUnsafe: async () => [] } as never;
  await assert.rejects(() => blockersFor("Client", "ajeno", "o1", tx), (error: unknown) => error instanceof TrashError && error.status === 404);
});

// ── Test de fuente: includes anidados a los modelos con papelera ─────────────

/** Relaciones to-many hacia los 7 modelos (Client.events/budgets, Event.budgets, Lead.budgets, QuoteComparison.budgets) y las de Organization. */
const RELATIONS = new Set(["events", "budgets", "clients", "leads", "suppliers", "promoters", "inventoryItems"]);
/** `events`/`budgets` que NO son relaciones a modelos con papelera, o conteos de bloqueo que deben ver todo. */
const ALLOWED_FILES = [
  "lib/server/signature/admin.ts", // SignatureRequest.events = eventos de firma
  "lib/server/signature/portal.ts", // SignatureRequest.events = eventos de firma
  "app/api/admin/ia/anular/route.ts", // conteo de historial del CLIENTE para BLOQUEAR el borrado: debe incluir lo eliminado (el ítem usa blockersFor)
  "lib/server/trash.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function propName(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): string | null {
  const name = node.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

test("los include/select/_count anidados de los modelos con papelera filtran con live", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "lib"]) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file);
      if (ALLOWED_FILES.includes(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (!/\b(include|select)\b/.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node, inSelection: boolean) => {
        let next = inSelection;
        // Constantes de include/select (`const X_INCLUDE = {...} satisfies Prisma.LeadInclude`).
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /(include|select)$/i.test(node.name.text)) next = true;
        if (ts.isSatisfiesExpression(node) && /(Include|Select)\b/.test(node.type.getText(sf))) next = true;
        if (ts.isPropertyAssignment(node)) {
          const key = propName(node);
          if (key && RELATIONS.has(key) && inSelection) {
            const init = node.initializer;
            const where = ts.isObjectLiteralExpression(init)
              ? init.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propName(p) === "where")
              : undefined;
            const ok = where && /\blive\b|deletedAt/.test(where.initializer.getText(sf));
            // Un select/include vacío de la relación como flag de booleano o sin where es una fuga.
            if (!ok) offenders.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${key}`);
          }
          if (key === "include" || key === "select" || key === "_count") next = true;
        }
        ts.forEachChild(node, (child) => visit(child, next));
      };
      visit(sf, false);
    }
  }
  assert.deepEqual(offenders, [], `Falta \`where: live\` (lib/server/trash-filter) en:\n${offenders.join("\n")}`);
});

test("E2: rutas de papelera de Evento/Producto exigen la capacidad correcta y el SQL crudo de eventos filtra lo eliminado", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  assert.match(read("app/api/admin/trash/route.ts"), /requireAdminContext\("trash\.manage"\)/);
  for (const path of ["app/api/admin/events/[id]/[action]/route.ts", "app/api/admin/inventory/[id]/[action]/route.ts"]) {
    const source = read(path);
    assert.match(source, /ACTION_CAPABILITY/);
    assert.match(source, /requireAdminContext\(capability\)/);
    assert.doesNotMatch(source, /dbWithDeleted/, "las rutas no tocan lo eliminado: lo hace trash-ops");
  }
  assert.match(read("app/api/admin/ia/anular/route.ts"), /annulInventoryItem/);
  assert.match(read("lib/server/trash-ops.ts"), /blockersFor\("InventoryItem"/);
  assert.match(read("lib/server/resumen-board.ts"), /FROM "Event"\s+WHERE "organizationId" = \$\{organizationId\} AND "deletedAt" IS NULL/);
});

test("papelera E2 fix: el reporte de dinero incluye eliminados, el lock del evento y la tabla cerrada (fuente)", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(path, "utf8");
  const report = read("lib/server/report-events.ts");
  assert.match(report, /deletedAt: undefined/);
  assert.match(report, /\(eliminado\)/);
  assert.match(read("app/(admin)/(print)/imprimir/reporte/page.tsx"), /loadMonthlyReportEvents/);
  assert.match(read("lib/server/rental-report.ts"), /rentableItemWhere\(organizationId\), deletedAt: undefined, id: \{ in: usedIds \}/);
  const availability = read("lib/server/inventory-availability.ts");
  assert.match(read("lib/server/event-lock.ts"), /"deletedAt" IS NULL FOR UPDATE/);
  assert.match(availability, /export \{ lockLiveEvent \} from "\.\/event-lock"/);
  assert.ok(availability.indexOf("lockInventoryItems(tx, options.organizationId, [options.inventoryId])") < availability.indexOf("lockLiveEvent(tx, options.organizationId, options.eventId)"), "orden: ítems antes que evento");
  const trash = read("lib/server/trash.ts");
  assert.match(trash, /const TABLES = \{/);
  assert.match(trash, /as const satisfies Record<TrashModel, string>/);
});

test("el 409 de bloqueo habla en castellano: «Tiene N cobros», sin claves internas", () => {
  const message = blockersMessage([{ kind: "payments", count: 2 }, { kind: "invoices", count: 1 }]);
  assert.match(message, /Tiene 2 cobros/);
  assert.match(message, /Tiene 1 factura\b/);
  assert.match(message, /anonimizarlo/);
  assert.doesNotMatch(message, /payments|invoices/);
  const error = blockedError([{ kind: "payments", count: 2 }]);
  assert.equal(error.status, 409);
  assert.deepEqual(error.blockers, [{ kind: "payments", count: 2 }]);
});
