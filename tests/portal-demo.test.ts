import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyPortalDemoState,
  emptyPortalDemoState,
  portalDemoKey,
  readPortalDemoState,
  reducePortalDemo,
  writePortalDemoState,
  type PortalDemoStorage,
} from "../lib/portal-demo";
import type { PortalBudget } from "../lib/server/budget-portal";

/**
 * Portal en modo demo (issue #52): las acciones del visitante se simulan en el
 * navegador y viven en `sessionStorage` por token. Acá se prueba el contrato de
 * esa simulación: la canónica no se toca, cada acción deja su marca visible y la
 * visita sobrevive la navegación (y solo esa visita).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** Storage en memoria: la sesión de una visita, sin navegador. */
function memoryStorage(initial: Record<string, string> = {}): PortalDemoStorage & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

/** Vista canónica mínima del presupuesto de ejemplo (sin persistencia). */
function budgetFixture(overrides: Partial<PortalBudget> = {}): PortalBudget {
  const item = { id: "it_1", name: "Pantalla LED", quantity: 6, days: 2, unitPrice: 800_000, subtotal: 9_600_000, notes: null };
  return {
    reference: "P-0001",
    title: "Alquiler de pantallas",
    status: "SENT",
    organization: "LedBox Demo",
    demo: true,
    createdAt: "2026-09-01T10:00:00.000Z",
    validUntil: null,
    deliveryAt: null,
    ivaType: null,
    warranty: null,
    notes: null,
    client: { name: "Ana Pérez", company: "ACME S.A.", contactName: "Ana Pérez", contactRole: "Compras" },
    event: null,
    items: [item],
    subtotal: 9_600_000,
    discount: 0,
    total: 9_600_000,
    paymentPlan: {
      advanceAmount: 0,
      installments: [],
      dueNow: { label: "Pago único", amount: 9_600_000 },
      scheduled: [],
      pending: 0,
      terms: null,
    },
    paymentDetails: null,
    demoPaymentDetails: { bank: "Ueno Bank", holder: "LedBox", ruc: null, account: "6191649354", alias: null },
    expectedPayments: [],
    proofs: [],
    proofUpload: { allowed: false, reason: "Todavía no recibimos este pago." },
    requests: [],
    timeline: [],
    approval: {
      state: "PENDIENTE",
      approvedAt: null,
      approvedByName: null,
      method: null,
      note: null,
      revisionRequestedAt: null,
      revisionNote: null,
    },
    ...overrides,
  };
}

test("la clave de la sesión es por token del presupuesto", () => {
  assert.equal(portalDemoKey("ABCD-EFGH"), "ledbox.portal.demo.ABCD-EFGH");
  assert.notEqual(portalDemoKey("uno"), portalDemoKey("otro"));
});

test("una visita sin acciones ve el estado canónico intacto", () => {
  const canonical = budgetFixture();
  const merged = applyPortalDemoState(canonical, emptyPortalDemoState());
  assert.deepEqual(merged, canonical);
  assert.equal(canonical.approval.approvedAt, null);
  assert.equal(canonical.proofs.length, 0);
});

test("autorizar simula la aprobación, los ajustes y abre el comprobante", () => {
  const canonical = budgetFixture();
  const state = reducePortalDemo(emptyPortalDemoState(), canonical, {
    type: "approve",
    at: "2026-09-23T12:00:00.000Z",
    name: "Ana Pérez",
    note: null,
    items: [{ id: "it_1", quantity: 8, days: 3 }],
    itemsNote: "Sumamos dos pantallas y un día.",
  });
  const merged = applyPortalDemoState(canonical, state);

  assert.equal(merged.status, "APPROVED");
  assert.equal(merged.approval.state, "APROBADO_DIGITAL");
  assert.equal(merged.approval.approvedAt, "2026-09-23T12:00:00.000Z");
  assert.equal(merged.approval.approvedByName, "Ana Pérez");
  assert.equal(merged.approval.method, "digital");
  assert.equal(merged.proofUpload.allowed, true);

  const request = merged.requests[0];
  assert.equal(request.kind, "items");
  assert.equal(request.status, "pending");
  assert.equal(request.requestedByName, "Ana Pérez");
  assert.equal(request.items[0].quantity, 8);
  assert.equal(request.items[0].previousQuantity, 6);
  assert.equal(request.items[0].subtotal, 8 * 3 * 800_000);

  // Los datos de pago de la empresa demo se ven recién con la aprobación visible.
  assert.equal(merged.paymentDetails?.bank, "Ueno Bank");
  // La canónica sigue sin aprobar: otro visitante ve el estado real.
  assert.equal(canonical.status, "SENT");
  assert.equal(canonical.approval.approvedAt, null);
  assert.equal(canonical.paymentDetails, null);
  assert.equal(canonical.proofUpload.allowed, false);
});

test("la rebaja pedida queda como solicitud con el descuento vigente", () => {
  const canonical = budgetFixture({ discount: 300_000 });
  const state = reducePortalDemo(emptyPortalDemoState(), canonical, {
    type: "discount",
    at: "2026-09-23T12:10:00.000Z",
    name: "Ana Pérez",
    note: "Ajusten el precio, por favor.",
    discount: { type: "percent", value: 5, amount: 480_000 },
  });
  const merged = applyPortalDemoState(canonical, state);
  const request = merged.requests[0];
  assert.equal(request.kind, "discount");
  assert.equal(request.note, "Ajusten el precio, por favor.");
  assert.deepEqual(request.discount, { type: "percent", value: 5, amount: 480_000, previousAmount: 300_000 });
  // Sin aprobación simulada no se abre nada más.
  assert.equal(merged.approval.approvedAt, null);
  assert.equal(merged.paymentDetails, null);
});

test("pedir un cambio deja la revisión marcada y su solicitud", () => {
  const canonical = budgetFixture();
  const state = reducePortalDemo(emptyPortalDemoState(), canonical, {
    type: "revision",
    at: "2026-09-23T12:20:00.000Z",
    name: "Ana Pérez",
    note: "Necesitamos mover el montaje al jueves.",
  });
  const merged = applyPortalDemoState(canonical, state);
  assert.equal(merged.approval.revisionRequestedAt, "2026-09-23T12:20:00.000Z");
  assert.equal(merged.approval.revisionNote, "Necesitamos mover el montaje al jueves. — Ana Pérez");
  assert.equal(merged.requests[0].kind, "changes");
  assert.equal(merged.approval.approvedAt, null);
});

test("un pedido de cambio no pisa una aprobación simulada", () => {
  const canonical = budgetFixture();
  const approved = reducePortalDemo(emptyPortalDemoState(), canonical, {
    type: "approve",
    at: "2026-09-23T12:00:00.000Z",
    name: "Ana Pérez",
    note: null,
    items: [],
    itemsNote: null,
  });
  const both = reducePortalDemo(approved, canonical, {
    type: "revision",
    at: "2026-09-23T12:30:00.000Z",
    name: "Ana Pérez",
    note: "Otro cambio.",
  });
  const merged = applyPortalDemoState(canonical, both);
  assert.equal(merged.approval.revisionRequestedAt, null);
  assert.equal(merged.approval.approvedAt, "2026-09-23T12:00:00.000Z");
});

test("el comprobante simulado guarda metadatos y sobrevive la sesión", () => {
  const canonical = budgetFixture();
  const storage = memoryStorage();
  const state = reducePortalDemo(emptyPortalDemoState(), canonical, {
    type: "proof",
    at: "2026-09-23T13:00:00.000Z",
    proof: { uploadedByName: "Ana Pérez", mime: "image/webp", size: 123_456, expectedPaymentId: null },
  });
  writePortalDemoState("CODIGO-1", state, storage);

  const restored = readPortalDemoState("CODIGO-1", storage);
  const merged = applyPortalDemoState(canonical, restored);
  assert.equal(merged.proofs.length, 1);
  assert.deepEqual(merged.proofs[0], {
    id: "demo-proof-2026-09-23T13:00:00.000Z",
    uploadedByName: "Ana Pérez",
    mime: "image/webp",
    size: 123_456,
    createdAt: "2026-09-23T13:00:00.000Z",
    status: "received",
  });
  // Otra visita (otro token) no ve nada de esta.
  assert.deepEqual(readPortalDemoState("CODIGO-2", storage), emptyPortalDemoState());
});

test("el storage con basura o bloqueado no rompe la vista", () => {
  const broken = memoryStorage({ [portalDemoKey("CODIGO-1")]: "{esto no es json" });
  assert.deepEqual(readPortalDemoState("CODIGO-1", broken), emptyPortalDemoState());

  const blocked: PortalDemoStorage = {
    getItem: () => {
      throw new Error("storage bloqueado");
    },
    setItem: () => {
      throw new Error("storage bloqueado");
    },
    removeItem: () => {
      throw new Error("storage bloqueado");
    },
  };
  assert.deepEqual(readPortalDemoState("CODIGO-1", blocked), emptyPortalDemoState());
  assert.doesNotThrow(() => writePortalDemoState("CODIGO-1", emptyPortalDemoState(), blocked));
});

test("la entrada al ejemplo deja una URL sin marcador demo", () => {
  const route = repoFile("app/api/portal/demo/route.ts");
  const pathFn = route.match(/function demoPath\(code: string\): string \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(pathFn, "la ruta del ejemplo resuelve el path del presupuesto");
  assert.doesNotMatch(pathFn, /\?demo=1/);
  assert.match(pathFn, /return `\/p\/\$\{code\}`;/);
  const page = repoFile("app/(portal)/p/[token]/page.tsx");
  assert.match(page, /budget\.demo/, "el modo demo se detecta por la empresa del presupuesto");
});
