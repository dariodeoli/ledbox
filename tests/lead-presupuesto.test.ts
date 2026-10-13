import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canWriteBudgets } from "../lib/admin-policy";
import { leadBudgetDraft } from "../lib/lead-budget-draft";
import { findMatchingClient, leadStatusAfterBudget, phoneKey, resolveClientFromLead } from "../lib/server/lead-client";
import { roleCan } from "../lib/server/permissions";

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const clients = [
  { id: "c-mail", name: "Ana", company: null, email: "Ana@Example.com ", phone: null },
  { id: "c-tel", name: "Luis", company: "Luis SA", email: null, phone: "0981 123 456" },
  { id: "c-corto", name: "Corto", company: null, email: null, phone: "123" },
];

test("dedup por email: ignora mayúsculas y espacios", () => {
  assert.equal(findMatchingClient(clients, { email: " ana@example.com", phone: "" })?.id, "c-mail");
  assert.equal(findMatchingClient(clients, { email: "otra@example.com", phone: "" }), undefined);
  assert.equal(findMatchingClient(clients, { email: "", phone: "" }), undefined);
});

test("dedup por teléfono: compara la clave nacional (+595, 0 inicial)", () => {
  assert.equal(phoneKey("+595 981 123-456"), "981123456");
  assert.equal(phoneKey("0981123456"), "981123456");
  assert.equal(findMatchingClient(clients, { email: "", phone: "+595981123456" })?.id, "c-tel");
  // Un número demasiado corto no identifica a nadie.
  assert.equal(phoneKey("123"), "");
  assert.equal(findMatchingClient(clients, { email: "", phone: "123" }), undefined);
});

test("resolveClientFromLead reutiliza el cliente y solo crea si no hay coincidencia", async () => {
  const created: unknown[] = [];
  const tx = {
    client: {
      findMany: async () => clients,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: data.id, name: data.name, company: data.company ?? null };
      },
    },
  };
  const lead = { name: "Nuevo", company: "Nuevo SRL", email: "Nuevo@Mail.com", phone: "0991 000 111", ruc: null };
  const reused = await resolveClientFromLead(tx as never, "org", { ...lead, email: "ana@example.com" });
  assert.deepEqual(reused, { client: { id: "c-mail", name: "Ana", company: null }, created: false });
  assert.equal(created.length, 0);
  assert.equal(await resolveClientFromLead(tx as never, "org", lead, { allowCreate: false }), null);
  const made = await resolveClientFromLead(tx as never, "org", lead);
  assert.equal(made?.created, true);
  assert.equal(created.length, 1);
  assert.equal((created[0] as { organizationId: string; type: string; email: string }).organizationId, "org");
  assert.equal((created[0] as { type: string }).type, "FINAL");
  assert.equal((created[0] as { email: string }).email, "nuevo@mail.com");
});

test("el estado del lead sube a Cotizado pero un lead ganado no baja", () => {
  assert.equal(leadStatusAfterBudget("NEW"), "QUOTED");
  assert.equal(leadStatusAfterBudget("CONTACTED"), "QUOTED");
  assert.equal(leadStatusAfterBudget("QUOTED"), "QUOTED");
  assert.equal(leadStatusAfterBudget("WON"), "WON");
  assert.equal(leadStatusAfterBudget("LOST"), "LOST");
});

test("precarga: título = motivo, notas con fecha, lugar y pedido; sin notas internas ni inventos", () => {
  const draft = leadBudgetDraft({ name: "Ana", company: null, reason: "Boda en Asunción", message: "Quiero una pantalla", eventDate: "2026-12-12T12:00:00.000Z", location: "Club Centenario" });
  assert.equal(draft.title, "Boda en Asunción");
  assert.equal(draft.eventDate, "2026-12-12");
  assert.equal(draft.notes, "Fecha del evento: 12/12/2026\nLugar: Club Centenario\nPedido: Quiero una pantalla");
  const bare = leadBudgetDraft({ name: "Ana", company: "Ana SA", reason: null, message: null, eventDate: null, location: null });
  assert.equal(bare.title, "Presupuesto para Ana SA");
  assert.equal(bare.notes, "");
  assert.equal(bare.eventDate, null);
});

test("permisos: solo OWNER/ADMIN/FINANCE arman presupuestos; VIEWER nunca", () => {
  for (const role of ["OWNER", "ADMIN", "FINANCE"] as const) {
    assert.equal(canWriteBudgets(role), true);
    assert.equal(roleCan(role, "budgets.write"), true);
  }
  for (const role of ["VIEWER", "OPERATIONS"] as const) {
    assert.equal(canWriteBudgets(role), false);
    assert.equal(roleCan(role, "budgets.write"), false);
  }
  assert.equal(canWriteBudgets(null), false);
});

test("POST /api/admin/budgets con leadId: 404 de otra empresa, transacción, auditoría y sin bloquear", () => {
  const route = repoFile("app/api/admin/budgets/route.ts");
  assert.match(route, /requireAdminContext\("budgets\.write"\)/, "el POST exige budgets.write (VIEWER = 403)");
  assert.match(route, /db\.lead\.findFirst\(\{ where: \{ id: leadId, organizationId \} \}\)/, "el lead se acota a la empresa activa");
  assert.match(route, /El lead no existe en esta empresa\.", 404/);
  assert.match(route, /resolveClientFromLead\(tx, organizationId, lead, \{ allowCreate: roleCan\(auth\.context\.user\.role, "clients\.write"\) \}\)/, "usa la conversión compartida, no una copia");
  assert.match(route, /db\.\$transaction\(async \(tx\) => \{[\s\S]*tx\.budget\.create[\s\S]*tx\.lead\.update/, "presupuesto, cliente y estado en una transacción");
  assert.match(route, /leadStatusAfterBudget\(lead\.status\)/);
  assert.match(route, /desde el lead «/, "queda en la auditoría");
  assert.match(route, /existingBudgets/, "devuelve los presupuestos previos del lead");
  assert.doesNotMatch(route, /existingBudgets\.length[^\n]*return jsonError/, "un presupuesto previo no bloquea");
  assert.match(route, /roleCan\(auth\.context\.user\.role, "clients\.write"\)/, "crear el cliente exige clients.write");
});

test("la conversión de /api/leads usa la función compartida", () => {
  const route = repoFile("app/api/leads/route.ts");
  assert.match(route, /resolveClientFromLead\(tx, auth\.context\.organizationId, lead\)/);
  assert.doesNotMatch(route, /function phoneKey/);
});

test("lead-draft: budgets.write, empresa activa y 404", () => {
  const route = repoFile("app/api/admin/budgets/lead-draft/route.ts");
  assert.match(route, /requireAdminContext\("budgets\.write"\)/);
  assert.match(route, /where: \{ id: leadId, organizationId \}/);
  assert.match(route, /404/);
});

test("UI: «Armar presupuesto» solo con permiso de presupuestos y sin datos personales en la URL", () => {
  const leads = repoFile("components/admin/modules/LeadsModule.tsx");
  assert.match(leads, /budgetWritable \? \([\s\S]{0,700}Armar presupuesto/);
  assert.match(leads, /\/presupuestos\?nuevo=1&lead=\$\{encodeURIComponent\(selected\.id\)\}/);
  const presupuestos = repoFile("components/admin/modules/PresupuestosModule.tsx");
  assert.match(presupuestos, /lead-draft\?leadId=/);
  // El enlace al lead de origen vive en el detalle del presupuesto (panel lateral).
  assert.match(repoFile("components/admin/modules/BudgetDetailDialog.tsx"), /Viene del lead del/);
  assert.match(leads, /Presupuesto \{budgetReference\(budget\.id\)\}/);
});

test("migración Budget.leadId: aditiva e idempotente", () => {
  const sql = repoFile("prisma/migrations/202610130001_budget_lead/migration.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "leadId"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "Budget_organizationId_leadId_idx"/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /duplicate_object/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|^UPDATE /im);
});
