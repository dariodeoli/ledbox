import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BUDGET_EVENT_NOTICE, budgetEventPrompt, eventDataFromBudget } from "../lib/budget-event";
import { budgetStages, installmentProgress } from "../lib/budget-stages";
import { clientHistory } from "../lib/client-history";
import { leadBelongsToClient } from "../lib/server/lead-client";
import { roleCan } from "../lib/server/permissions";

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("el aviso pide crear el evento solo si está aprobado y no tiene evento", () => {
  assert.equal(budgetEventPrompt({ status: "APPROVED", event: null }), "create");
  assert.equal(budgetEventPrompt({ status: "APPROVED", eventId: null }), "create");
  assert.equal(budgetEventPrompt({ status: "SENT", event: null }), null);
  assert.equal(budgetEventPrompt({ status: "DRAFT", event: null }), null);
  assert.equal(budgetEventPrompt({ status: "LOST", event: null }), null);
  assert.equal(budgetEventPrompt({ status: "APPROVED", event: { status: "CONFIRMED" } }), null);
  assert.equal(budgetEventPrompt({ status: "APPROVED", event: { status: "IN_PROGRESS" } }), null);
  assert.equal(BUDGET_EVENT_NOTICE, "El cliente aprobó el presupuesto. Falta crear el evento");
});

test("un evento en borrador de un presupuesto aprobado se confirma, no se crea de nuevo", () => {
  assert.equal(budgetEventPrompt({ status: "APPROVED", event: { status: "DRAFT" } }), "confirm");
  assert.equal(budgetEventPrompt({ status: "SENT", event: { status: "DRAFT" } }), null, "sin aprobar no hay nada que confirmar");
});

test("el evento nace CONFIRMED con el título y solo las fechas que el presupuesto tiene", () => {
  const delivery = new Date("2026-11-20T13:00:00.000Z");
  assert.deepEqual(eventDataFromBudget({ title: "  Activación Tigo  ", deliveryAt: delivery }), { name: "Activación Tigo", startsAt: delivery, status: "CONFIRMED" });
  assert.equal(eventDataFromBudget({ title: "Sin fecha", deliveryAt: null }).startsAt, null, "no se inventa una fecha");
  assert.equal(eventDataFromBudget({ title: "x".repeat(300), deliveryAt: null }).name.length, 160);
});

test("las etapas siguen Lead → Presupuesto → Aprobado → Evento → Cobrado", () => {
  const base = { status: "SENT", total: 1_000_000, collected: 0, event: null, expectedPayments: [] };
  assert.deepEqual(budgetStages(base).map((stage) => stage.key), ["budget", "approved", "event", "paid"], "sin lead no hay etapa Lead");
  const sent = budgetStages({ ...base, leadId: "lead 1" });
  assert.deepEqual(sent.map((stage) => [stage.key, stage.state]), [["lead", "done"], ["budget", "current"], ["approved", "todo"], ["event", "todo"], ["paid", "todo"]]);
  assert.equal(sent[0].href, "/leads?lead=lead%201", "el lead lleva link");
  const approved = budgetStages({ ...base, status: "APPROVED", approvedAt: "2026-10-01T10:00:00Z" });
  assert.deepEqual(approved.map((stage) => [stage.key, stage.state]), [["budget", "done"], ["approved", "done"], ["event", "current"], ["paid", "todo"]]);
  assert.equal(approved.find((stage) => stage.key === "event")?.href, undefined, "sin evento no hay link");
  const withEvent = budgetStages({ ...base, status: "APPROVED", event: { id: "e1", name: "Expo" }, collected: 400_000 });
  assert.equal(withEvent.find((stage) => stage.key === "event")?.state, "done");
  assert.equal(withEvent.find((stage) => stage.key === "event")?.href, "/eventos?evento=e1", "la etapa Evento abre la ficha de ese evento");
  assert.equal(withEvent.find((stage) => stage.key === "paid")?.state, "current");
  const paid = budgetStages({ ...base, status: "APPROVED", event: { id: "e1", name: "Expo" }, collected: 1_000_000 });
  assert.equal(paid.find((stage) => stage.key === "paid")?.state, "done");
});

test("cobrado muestra cuotas pagadas / total sin contar las canceladas", () => {
  assert.equal(installmentProgress(undefined), null);
  assert.equal(installmentProgress([]), null);
  assert.deepEqual(installmentProgress([{ status: "CONFIRMED" }, { status: "AWAITING" }, { status: "PARTIAL" }, { status: "CANCELLED" }]), { paid: 1, total: 3 });
  const stages = budgetStages({ status: "APPROVED", total: 9, collected: 3, event: null, expectedPayments: [{ status: "CONFIRMED" }, { status: "AWAITING" }, { status: "AWAITING" }] });
  assert.equal(stages.find((stage) => stage.key === "paid")?.detail, "1/3 cuotas");
});

test("los leads del cliente: origen de un presupuesto o coincidencia por email o teléfono", () => {
  const client = { emails: ["Eventos@Tigo.demo", null], phones: ["+595 981 214 500", undefined] };
  const none = new Set<string>();
  assert.equal(leadBelongsToClient({ id: "a", email: " eventos@tigo.demo ", phone: "000" }, client, none), true, "email sin mayúsculas");
  assert.equal(leadBelongsToClient({ id: "b", email: "otro@x.demo", phone: "0981 214 500" }, client, none), true, "clave nacional del teléfono");
  assert.equal(leadBelongsToClient({ id: "c", email: "otro@x.demo", phone: "0981 000 000" }, client, none), false);
  assert.equal(leadBelongsToClient({ id: "d", email: "otro@x.demo", phone: "123" }, { emails: [], phones: ["123"] }, none), false, "un teléfono corto no identifica a nadie");
  assert.equal(leadBelongsToClient({ id: "e", email: "otro@x.demo", phone: "0981 000 000" }, client, new Set(["e"])), true, "lo creó un presupuesto del cliente");
});

test("el historial de la ficha solo usa hechos con fecha real, del más nuevo al más viejo", () => {
  const entries = clientHistory({
    leads: [{ id: "l1", name: "Ana", phone: "1", email: "a@x", company: null, reason: "Expo", eventDate: null, source: "website", status: "NEW", createdAt: "2026-09-01T10:00:00Z" }],
    budgets: [{ id: "b1", leadId: "l1", title: "Pantallas", status: "APPROVED", total: 1, createdAt: "2026-09-02T10:00:00Z", validUntil: null, approvedAt: "2026-09-05T10:00:00Z", approvalMethod: "manual", event: null, collected: 0, overdue: 0 }],
    events: [{ id: "e1", name: "Expo", location: null, startsAt: null, endsAt: null, status: "CONFIRMED", createdAt: "2026-09-06T10:00:00Z", tasks: [] }],
    payments: [
      { id: "p1", status: "RECEIVED", collectedAt: "2026-09-07T10:00:00Z", paidAt: null, budget: { id: "b1", title: "Pantallas" } },
      { id: "p2", status: "PENDING", collectedAt: null, paidAt: null, budget: null },
      { id: "p3", status: "RECEIVED", collectedAt: null, paidAt: null, budget: null },
    ] as never,
  });
  assert.deepEqual(entries.map((entry) => entry.id), ["payment:p1", "event:e1", "approved:b1", "budget:b1", "lead:l1"]);
});

test("create-event: events.write, acotado a la empresa, FOR UPDATE, 404/409 y reserva por el camino existente", () => {
  const route = repoFile("app/api/admin/budgets/[id]/create-event/route.ts");
  assert.match(route, /requireAdminContext\("events\.write"\)/, "el permiso se revalida en el servidor");
  assert.equal(roleCan("VIEWER", "events.write"), false, "VIEWER no crea eventos");
  assert.equal(roleCan("FINANCE", "events.write"), false);
  assert.equal(roleCan("OPERATIONS", "events.write"), true);
  assert.match(route, /where: \{ id, organizationId \}/, "toda lectura va por la empresa activa");
  assert.match(route, /Presupuesto no encontrado\.", 404/, "uno de otra empresa responde 404");
  assert.match(route, /El presupuesto ya tiene un evento\.", 409/, "con evento responde 409");
  assert.match(route, /FROM "Budget" WHERE "id" = \$\{id\} AND "organizationId" = \$\{organizationId\} FOR UPDATE/, "dos clics simultáneos se serializan");
  assert.ok(route.indexOf("FOR UPDATE") < route.indexOf("tx.event.create"), "el candado va antes de crear");
  assert.match(route, /eventId: event\.id/, "vincula budget.eventId");
  assert.match(route, /desde el presupuesto PRES-/, "auditoría con el código del presupuesto");
  assert.match(route, /reserveBudgetInventory\(\{ organizationId, budgetId: created\.budget\.id/, "reserva con la firma actual");
  assert.ok(route.indexOf("$transaction") < route.indexOf("reserveBudgetInventory("), "la reserva corre después de la transacción");
});

test("aprobar no crea el evento solo: lo decide el botón", () => {
  for (const file of ["app/api/portal/budget/[token]/approve/route.ts", "app/api/admin/budgets/approval/route.ts"]) {
    assert.equal(/tx\.event\.create|db\.event\.create/.test(repoFile(file)), false, `${file} no crea eventos`);
  }
});

test("Presupuestos: aviso con «Crear evento» en tabla, tarjetas y detalle, y precarga del cliente", () => {
  const module = repoFile("components/admin/modules/PresupuestosModule.tsx");
  // Tabla, tarjetas y tablero comparten la acción de la fila: «Crear evento» es la
  // acción principal del aprobado sin evento (y queda también en el menú «•••»).
  assert.match(module, /case "create_event": return void createEventFor\(budget\)/, "acción de la fila en tabla, tarjetas y tablero");
  assert.match(module, /footer: rowActions\(budget\)/, "acción en las tarjetas");
  assert.match(module, /label: "Crear evento", icon: "events"/, "«Crear evento» también en el menú");
  assert.match(module, /onCreateEvent: \(\) => void createEventFor\(budget\)/, "acción en el detalle");
  assert.match(module, /<BudgetDetailDialog/, "aviso y etapas en el detalle");
  assert.match(module, /\/api\/admin\/budgets\/\$\{budget\.id\}\/create-event/);
  assert.match(module, /eventInFlight\.current/, "single-flight en el clic");
  assert.match(module, /status: "CONFIRMED" \}, "PATCH"/, "«Confirmar evento» pasa el borrador a CONFIRMED");
  assert.match(module, /searchParams\.get\("cliente"\)/, "?cliente= precarga el cliente");
  const notice = repoFile("components/admin/BudgetEventNotice.tsx");
  assert.match(notice, /Crear evento/);
  assert.match(notice, /Confirmar evento/);
  assert.match(notice, /canAct \?/, "sin permiso solo informa");
  const detail = repoFile("components/admin/modules/BudgetDetailDialog.tsx");
  assert.match(detail, /<StageTrail/);
  assert.match(detail, /<BudgetEventNotice/, "el detalle conserva el aviso con el botón");
  assert.ok(repoFile("app/globals.css").includes(".admin-stage-trail"), "el CSS de la barra vive en globals.css");
});

test("la ficha del cliente es una página propia y la ventana ya no existe", () => {
  const page = repoFile("app/(admin)/(panel)/clientes/[id]/page.tsx");
  assert.match(page, /organizationId: auth\.context\.organizationId/, "el cliente se busca en la empresa activa");
  assert.match(page, /if \(!client\) notFound\(\)/, "otra empresa → 404");
  const clientes = repoFile("components/admin/modules/ClientesModule.tsx");
  assert.equal(clientes.includes("ClientDetailDialog"), false, "sin código muerto");
  assert.equal(clientes.includes("ClientDetailBody"), false);
  assert.match(clientes, /href=\{`\/clientes\/\$\{client\.id\}`\}/, "la fila navega a la ficha");
  const ficha = repoFile("components/admin/modules/ClienteFichaModule.tsx");
  for (const tab of ["Presupuestos", "Eventos", "Cobros", "Leads", "Historial", "Datos"]) assert.ok(ficha.includes(`label: "${tab}"`), `falta la pestaña ${tab}`);
  assert.match(ficha, /canWriteClients\(role\)/, "Editar solo con permiso");
  assert.match(ficha, /canWriteBudgets\(role\)/, "Nuevo presupuesto solo con permiso");
  assert.match(ficha, /\/presupuestos\?nuevo=1&cliente=/);
  assert.match(ficha, /<AdminWhatsappLink/, "WhatsApp con el helper existente");
  const api = repoFile("app/api/admin/clients/[id]/route.ts");
  assert.match(api, /leadsForClient\(db, organizationId,/, "los leads salen acotados por empresa");
  const leadLib = readFileSync("lib/server/lead-client.ts", "utf8");
  const forClient = leadLib.slice(leadLib.indexOf("export async function leadsForClient"), leadLib.indexOf("export type ResolvedLeadClient"));
  assert.match(forClient, /where: \{ organizationId(,| \})/, "toda consulta de leads lleva organizationId");
  assert.doesNotMatch(forClient, /where: \{ (?!organizationId)/);
  assert.match(forClient, /leadBelongsToClient/);
});
