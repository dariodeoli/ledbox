import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AdminEventAssignment, AdminEventPanelRow } from "../lib/admin-types";
import {
  assignmentControls,
  depositState,
  eventPhase,
  eventReadiness,
  matchesFocus,
} from "../lib/event-readiness";

const read = (path: string) => readFileSync(path, "utf8");
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function assignment(patch: Partial<AdminEventAssignment> = {}): AdminEventAssignment {
  return {
    id: "a1",
    eventId: "e1",
    quantity: 4,
    startsAt: null,
    endsAt: null,
    checkedOut: false,
    checkedIn: false,
    checkedOutAt: null,
    checkedInAt: null,
    conditionOut: null,
    conditionIn: null,
    damagedQuantity: 0,
    missingQuantity: 0,
    damageNotes: null,
    inventory: { id: "i1", name: "Pantalla LED", sku: null, _count: { components: 0 } },
    ...patch,
  };
}

function event(patch: Partial<AdminEventPanelRow> = {}): AdminEventPanelRow {
  return {
    id: "e1",
    name: "Expo",
    location: null,
    city: null,
    setupAt: null,
    startsAt: iso(48 * HOUR),
    endsAt: iso(60 * HOUR),
    strikeAt: null,
    status: "CONFIRMED",
    notes: null,
    client: { id: "c1", name: "Ana", company: null, phone: null, tradeName: null, legalName: null },
    assignments: [],
    tasks: [],
    ...patch,
  } as AdminEventPanelRow;
}

const task = (id: string, done: boolean, extra: Record<string, unknown> = {}) =>
  ({ id, eventId: "e1", type: "SETUP", title: `Tarea ${id}`, dueAt: null, completedAt: done ? iso(-HOUR) : null, ...extra }) as AdminEventPanelRow["tasks"][number];

test("la siguiente acción lógica sigue el orden checklist, despachar, devolver y finalizar", () => {
  // Próximo con checklist abierto: lo primero es completarlo.
  const upcoming = eventReadiness(event({ tasks: [task("1", false)], assignments: [assignment()] }));
  assert.equal(upcoming.next?.key, "checklist");
  assert.equal(upcoming.next?.label, "Completar checklist");

  // Checklist al día y equipos sin salir (evento en 2 días): despachar.
  const ready = eventReadiness(event({ tasks: [task("1", true)], assignments: [assignment()] }));
  assert.equal(ready.next?.key, "dispatch");

  // Todo despachado y el evento aún no empezó: nada que hacer.
  const out = eventReadiness(event({ tasks: [task("1", true)], assignments: [assignment({ checkedOut: true, checkedOutAt: iso(-HOUR) })] }));
  assert.equal(out.next, null);

  // Pasó el evento con equipos afuera: registrar la devolución.
  const ended = event({
    startsAt: iso(-30 * HOUR),
    endsAt: iso(-6 * HOUR),
    tasks: [task("1", true)],
    assignments: [assignment({ checkedOut: true, checkedOutAt: iso(-40 * HOUR) })],
  });
  assert.equal(eventReadiness(ended).next?.key, "return");
  assert.equal(eventReadiness(ended).phase, "ended");

  // Devuelto todo: finalizar.
  const returned = { ...ended, assignments: [assignment({ checkedOut: true, checkedIn: true, checkedOutAt: iso(-40 * HOUR), checkedInAt: iso(-5 * HOUR), returnedQuantity: 4, checkoutQuantity: 4 })] };
  assert.equal(eventReadiness(returned).next?.key, "finalize");

  // Finalizado o cancelado: sin acción ni faltantes.
  for (const status of ["COMPLETED", "CANCELLED"]) {
    const closed = eventReadiness({ ...ended, status });
    assert.equal(closed.next, null);
    assert.deepEqual(closed.gaps, []);
    assert.equal(closed.phase, "closed");
  }
});

test("un evento lejano con equipos sin salir no pide despacho todavía", () => {
  const far = eventReadiness(event({ startsAt: iso(30 * 24 * HOUR), endsAt: iso(31 * 24 * HOUR), tasks: [task("1", true)], assignments: [assignment()] }));
  assert.equal(far.next, null);
  assert.deepEqual(far.gaps, []);
});

test("los combos no cuentan como unidades sueltas: se mueven por sus componentes", () => {
  const combo = assignment({ id: "combo", quantity: 2, inventory: { id: "i2", name: "Combo", sku: null, _count: { components: 3 } } });
  const readiness = eventReadiness(event({ tasks: [task("1", true)], assignments: [combo, assignment()] }));
  assert.equal(readiness.equipment.units, 4, "solo las unidades sueltas");
  assert.equal(readiness.equipment.combos, 1);
  assert.equal(assignmentControls(combo).canDispatch, false);
  assert.equal(assignmentControls(combo).canReturn, false);
});

test("los controles de una asignación respetan despacho parcial, devolución y edición", () => {
  const fresh = assignmentControls(assignment());
  assert.deepEqual([fresh.canDispatch, fresh.canReturn, fresh.canEdit], [true, false, true]);
  const partial = assignmentControls(assignment({ checkedOut: true, checkedOutAt: iso(-HOUR), checkoutQuantity: 2 }));
  assert.deepEqual([partial.canDispatch, partial.canReturn, partial.canEdit], [true, true, false], "salió 2 de 4: se puede seguir despachando y devolver lo que salió");
  const back = assignmentControls(assignment({ checkedIn: true, checkedInAt: iso(-HOUR), checkedOut: true, checkedOutAt: iso(-3 * HOUR) }));
  assert.deepEqual([back.canDispatch, back.canReturn, back.canEdit], [false, false, false]);
  // Una salida en cola cuenta como hecha: la fila no ofrece repetirla.
  const queued = eventReadiness(event({ tasks: [task("1", true)], assignments: [assignment()] }), { queued: () => "out" });
  assert.equal(queued.equipment.toDispatch, 0);
  assert.equal(queued.next, null);
});

test("qué falta cuenta checklist, vencidas, despacho, devolución, promotoras y seña", () => {
  const promoter = { id: "p1", name: "Lucía", availability: "UNAVAILABLE", availabilityNote: "Viaje", unavailableUntil: null };
  const readiness = eventReadiness(
    event({
      startsAt: iso(24 * HOUR),
      tasks: [task("1", false, { dueAt: iso(-48 * HOUR) }), task("2", true), task("3", false, { promoter, promoterId: "p1" })],
      assignments: [assignment()],
    }),
    { deposit: "pending" },
  );
  assert.deepEqual(readiness.gaps.map((gap) => gap.key), ["checklist", "dispatch", "promoter", "deposit"]);
  assert.match(readiness.gaps[0].label, /2 tareas pendientes \(1 vencida\)/);
  assert.equal(readiness.gaps[0].tone, "danger");
  assert.equal(readiness.promoters.count, 1);
  assert.deepEqual(readiness.promoters.unavailable, ["Lucía"]);
});

test("la seña es honesta: sin lectura del presupuesto queda «unknown», nunca «paid»", () => {
  assert.equal(depositState(null, false), "unknown");
  assert.equal(depositState(null, true), "none");
  assert.equal(depositState({ advanceAmount: 0, collected: 500 }, true), "none");
  assert.equal(depositState({ advanceAmount: 500_000, collected: 200_000 }, true), "pending");
  assert.equal(depositState({ advanceAmount: 500_000, collected: 500_000 }, true), "paid");
});

test("cada indicador de la cabecera filtra con su propio criterio", () => {
  const upcoming = event();
  const live = event({ status: "IN_PROGRESS", startsAt: iso(-2 * HOUR), endsAt: iso(5 * HOUR) });
  const ended = event({ startsAt: iso(-30 * HOUR), endsAt: iso(-6 * HOUR) });
  const closed = event({ status: "COMPLETED", startsAt: iso(-30 * HOUR), endsAt: iso(-6 * HOUR) });
  const gaps = event({ startsAt: iso(30 * 24 * HOUR), endsAt: iso(31 * 24 * HOUR), tasks: [task("1", false)] });
  const hits = (candidate: AdminEventPanelRow, focus: Parameters<typeof matchesFocus>[1]) => matchesFocus(candidate, focus, eventReadiness(candidate));
  assert.equal(hits(upcoming, "next7"), true);
  assert.equal(hits(gaps, "next7"), false, "a 30 días no es de la semana");
  assert.equal(hits(live, "live"), true);
  assert.equal(hits(upcoming, "live"), false);
  assert.equal(hits(ended, "close"), true, "pasó y sigue abierto");
  assert.equal(hits(closed, "close"), false, "finalizado no es «por cerrar»");
  assert.equal(hits(gaps, "gaps"), true);
  assert.equal(hits(closed, "gaps"), false);
  assert.equal(eventPhase(closed), "closed");
});

test("el StageTrail del presupuesto abre el evento por id y /eventos lee ?evento=", () => {
  assert.match(read("lib/budget-stages.ts"), /`\/eventos\?evento=\$\{encodeURIComponent\(input\.event\.id\)\}`/);
  const module = read("components/admin/modules/EventosModule.tsx");
  assert.match(module, /searchParams\.get\("evento"\)/, "el detalle se abre por link");
  assert.match(module, /No encontramos ese evento en esta empresa\./, "un id ajeno o inexistente se avisa, no abre nada");
  assert.match(module, /<EventoFicha\b/);
  assert.match(read("components/admin/modules/EventoFicha.tsx"), /size="ficha"/, "el detalle es el panel lateral");
});

test("permisos intactos: sin permiso de escritura no hay siguiente acción, edición ni formularios", () => {
  const module = read("components/admin/modules/EventosModule.tsx");
  const ficha = read("components/admin/modules/EventoFicha.tsx");
  assert.match(module, /const writable = canWriteOperations\(role\);/);
  assert.match(module, /\{writable \? <NextActionButton item=\{item\} onRun=\{runNext\}/, "la fila solo ofrece la siguiente acción con permiso");
  assert.match(module, /if \(!next \|\| !writable\) return;/, "runNext ignora a quien no escribe");
  assert.match(module, /if \(writable\) entries\.push\(\{ label: "Editar evento"/);
  assert.match(module, /if \(writable && whatsappHref\(event\.client\.phone\)\)/);
  assert.match(module, /const closable = writable && !isEventClosed\(event\)/);
  assert.match(module, /\{writable && showForm \?/, "el alta/edición sigue detrás del permiso");
  assert.match(module, /\{writable && closeBlock \?/, "«Cerrar igual» sigue detrás del permiso");
  assert.match(ficha, /\{writable \? <NextActionButton/);
  assert.match(ficha, /\{writable \? <TaskAddForm/);
  assert.match(ficha, /\{writable \? \(\s*<form className="admin-inline-form" onSubmit=\{submit\}>/, "asignar equipos solo con permiso");
  assert.match(ficha, /canToggle=\{writable\}/);
  assert.match(ficha, /\{writable && controls\.canDispatch/);
  assert.match(ficha, /\{writable && controls\.canReturn/);
  assert.match(ficha, /\{writable && controls\.canEdit/);
  assert.match(ficha, /<InventoryIncidentsPanel eventId=\{event\.id\} writable=\{writable\}/);
});

test("ninguna acción se pierde: despacho, devolución, incidentes, checklist, asignación, finalizar y cerrar igual siguen", () => {
  const module = read("components/admin/modules/EventosModule.tsx");
  const ficha = read("components/admin/modules/EventoFicha.tsx");
  for (const text of ['"/api/admin/events", { id: event.id, status: "COMPLETED" }', "forceClose: true, forceCloseNote: note", 'result.code === "closure_blocked"', "<InventoryMovementDialog", "Imprimir orden de trabajo", "Enviar por WhatsApp con plantilla", "Ver cronología", "<MessageTemplateSendDialog", "<ClientQuickDialog"]) {
    assert.ok(module.includes(text), `falta en el módulo: ${text}`);
  }
  for (const text of ['kind: "task"', 'kind: "assignment"', 'kind: "assignment-delete"', "<InventoryIncidentsPanel", "<ChecklistTable", "AdminTimelineLoader", "Despachar", "Registrar devolución", "Editar asignación", "Quitar asignación", ">Combo<"]) {
    assert.ok(ficha.includes(text), `falta en la ficha: ${text}`);
  }
  // Los cuatro indicadores de la cabecera son botones que filtran.
  for (const label of ["Próximos 7 días", "En curso", "Faltantes o checklist incompleto", "Por cerrar"]) {
    assert.ok(module.includes(label), `falta el indicador «${label}»`);
  }
  const ui = read("components/admin/AdminUI.tsx");
  assert.match(ui, /aria-pressed/, "el indicador que filtra expone su estado");
  assert.match(ui, /onSelect\?: \(\) => void/, "una sola API: onSelect + active + actionLabel");
  assert.ok(!/admin-kpi--action|onClick\?: \(\) => void;\s*active/.test(ui), "no queda un segundo nombre para el mismo comportamiento");
  assert.match(module, /onSelect: \(\) => toggleFocus/, "Eventos usa onSelect");
});
