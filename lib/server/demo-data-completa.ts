import { Prisma } from "@prisma/client";
import { DAY_MS, dayKeyOf, dayStart } from "./notifications";
import { computeSignatureEventHash, sha256Hex } from "./signature/hash";
import { signatureIdentifierFor, signedDocumentHash, SNAPSHOT_DOCUMENT_VERSION } from "./signature/document";
import type { DemoBudgetSeed } from "./demo-data";

/**
 * Datos que completan la demo (pedido del dueño: «full funcional, completita»).
 *
 * Complementan el dataset base de `demo-data.ts` con los estados que le
 * faltaban, siempre con fechas relativas a HOY y sin duplicar nada:
 *
 * - Inventario: un producto agotado hoy, uno agotado en un rango por una
 *   reserva, uno en mantenimiento (unidades en reparación, dañada y en limpieza),
 *   un combo más, uno archivado y uno eliminado, unidades retiradas y
 *   incidentes resueltos y dados de baja.
 * - Presupuestos: cancelado, vencido, aprobado con firma, pagado completo con
 *   depósito retenido en parte, uno archivado y uno eliminado.
 * - Firmas: una solicitud en cada estado (borrador, enviada, vista, firmada,
 *   validada, rechazada, vencida y cancelada) con su cadena de auditoría real.
 * - Papelera: algo archivado y algo eliminado en cada entidad.
 *
 * Todo es consistente con el motor de reservas (`inventory-availability.ts`):
 * «agotado» sale de reservas y unidades reales, nunca de un campo suelto. Los
 * nombres, teléfonos y correos son inventados (`@ledbox.demo`).
 */

type Rows<T> = Array<T & { id: string }>;

/** Evento mínimo que la completación necesita (rango y cliente). */
export type DemoEventRef = {
  id: string;
  clientId: string;
  setupAt: Date;
  startsAt: Date;
  endsAt: Date;
  strikeAt: Date;
};

export type DemoCompletionInput = {
  organizationId: string;
  base: Date;
  now: Date;
  /** Todos los eventos del dataset base por id (para colgar presupuestos). */
  events: ReadonlyMap<string, DemoEventRef>;
  next: DemoEventRef;
  inProgress: DemoEventRef;
  recentPast: DemoEventRef;
  pastFiller: DemoEventRef;
  second: DemoEventRef;
  cancelled: DemoEventRef;
  /** Nombre de la persona de contacto de un cliente (los presupuestos nuevos lo usan al aprobar). */
  contactNameOf: (clientId: string) => string;
  /** Sandbox: token público al azar por sandbox (la vitrina usa el literal). */
  tk?: (literal: string) => string;
};

const SALES = { id: "demo_user_valeria", name: "Valeria Ortiz", email: "valeria.ortiz@ledbox.demo" } as const;
const TREASURY_BANK = "demo_treasury_ueno";

function at(base: Date, days: number, hour: number, minute = 0): Date {
  return new Date(base.getTime() + days * DAY_MS + (hour * 60 + minute) * 60_000);
}

function pastOf(date: Date, now: Date): Date {
  return date.getTime() > now.getTime() ? new Date(now.getTime() - 60_000) : date;
}

/** Códigos de las unidades que agrega la completación (únicos por empresa). */
export const DEMO_COMPLETION_UNIT_PREFIXES = ["MIC", "GEN", "PRY", "SOP", "PNL", "NEO"] as const;

/** Lo que la completación espera ver en el motor: la prueba lo compara con `availabilityForRange`. */
export const DEMO_COMPLETION_EXPECTED = {
  /** Agotado hoy: toda la cantidad está afuera en un evento en curso. */
  soldOutNow: { id: "demo_inv_microfono", total: 4 },
  /** Agotado en el rango del próximo evento por una reserva firme (hoy sigue libre). */
  soldOutInRange: { id: "demo_inv_generador", total: 3 },
  /** En mantenimiento: todas sus unidades fuera de circulación. */
  maintenance: { id: "demo_inv_proyector", total: 3 },
  archived: "demo_inv_led_p10",
  deleted: "demo_inv_cartel_neon",
  combo: "demo_inv_kit_activacion",
  /** Presupuestos nuevos: un id por estado que antes faltaba. */
  budgets: {
    cancelled: "demo_budget_cancelado",
    expired: "demo_budget_vencido",
    signed: "demo_budget_firmado",
    paidInFull: "demo_budget_pagado_retenido",
    archived: "demo_budget_archivado",
    deleted: "demo_budget_eliminado",
  },
  signatureStatuses: ["DRAFT", "SENT", "VIEWED", "SIGNED", "VALIDATED", "REJECTED", "EXPIRED", "CANCELLED"],
} as const;

type InventoryItemInput = Omit<Prisma.InventoryItemUncheckedCreateInput, "organizationId">;

export type DemoCompletion = {
  budgetSeeds: DemoBudgetSeed[];
  payments: Rows<Omit<Prisma.ClientPaymentUncheckedCreateInput, "id">>;
  expectedPayments: Prisma.ExpectedPaymentUncheckedCreateInput[];
  supplierJobs: Rows<Omit<Prisma.SupplierJobUncheckedCreateInput, "id">>;
  suppliers: Prisma.SupplierUncheckedCreateInput[];
  clients: Prisma.ClientUncheckedCreateInput[];
  leads: Prisma.LeadUncheckedCreateInput[];
  promoters: Prisma.PromoterUncheckedCreateInput[];
  events: Prisma.EventUncheckedCreateInput[];
  inventoryItems: Prisma.InventoryItemUncheckedCreateInput[];
  inventoryUnits: Prisma.InventoryUnitUncheckedCreateInput[];
  inventoryComponents: Prisma.InventoryComponentUncheckedCreateInput[];
  assignments: Prisma.EventInventoryUncheckedCreateInput[];
  incidents: Prisma.InventoryIncidentUncheckedCreateInput[];
  catalogTokens: Prisma.CatalogAccessTokenUncheckedCreateInput[];
};

export function buildDemoCompletion(input: DemoCompletionInput): DemoCompletion {
  const { organizationId, base, now, next, inProgress, recentPast, pastFiller, second, cancelled, contactNameOf } = input;
  const tk = input.tk ?? ((literal: string) => literal);
  const org = { organizationId };
  const archivedBy = { archivedById: SALES.id };

  // ── Presupuestos ──────────────────────────────────────────────────────────
  const signedEvent = input.events.get("demo_event_marco_solis") ?? second;
  const budgetSeeds: DemoBudgetSeed[] = [
    {
      id: "demo_budget_cancelado",
      clientId: "demo_client_cellshop",
      title: "Pantallas para lanzamiento · Cellshop",
      status: "CANCELLED",
      discount: 0,
      validUntil: at(base, -20, 18),
      notes: "Cancelado: el cliente postergó el lanzamiento antes de aprobar.",
      createdAt: at(base, -32, 10, 0),
      items: [
        { id: "demo_budget_item_can1", name: "Pantalla LED P3.9 500x500", quantity: 6, days: 2, unitPrice: 450_000, costPrice: 180_000, inventoryId: "demo_inv_led_p3" },
        { id: "demo_budget_item_can2", name: "Operación técnica", quantity: 1, days: 2, unitPrice: 520_000, costPrice: 210_000 },
      ],
    },
    {
      id: "demo_budget_vencido",
      clientId: "demo_client_personal",
      title: "Tótems de consulta · jornada de negocios",
      status: "SENT",
      discount: 0,
      validUntil: at(base, -6, 18),
      notes: "Venció sin respuesta del cliente; conviene reenviarlo con vigencia nueva.",
      token: "V3NC-1D0S-7QAB-9K2M-XT4R",
      tokenCreatedAt: at(base, -24, 11, 0),
      createdAt: at(base, -24, 10, 30),
      items: [
        { id: "demo_budget_item_ven1", name: "Tótem LED 2x1 m", quantity: 2, days: 1, unitPrice: 1_800_000, costPrice: 700_000, inventoryId: "demo_inv_totem" },
        { id: "demo_budget_item_ven2", name: "Tótem Touch 43\"", quantity: 1, days: 1, unitPrice: 1_200_000, costPrice: 450_000, inventoryId: "demo_inv_totem_touch" },
      ],
    },
    {
      id: "demo_budget_firmado",
      event: signedEvent,
      title: "Pantallas laterales y streaming · Marco Antonio Solís",
      status: "APPROVED",
      discount: 500_000,
      validUntil: at(base, 6, 18),
      notes: "Aprobado y firmado digitalmente. El depósito de garantía se cobra antes del montaje.",
      securityDeposit: { amount: 1_500_000, status: "PENDING" },
      plan: {
        advance: 4_000_000,
        terms: "Anticipo del 40% con la firma y saldo en dos cuotas antes del evento.",
        installments: [
          { label: "Cuota 1", amount: 3_000_000, dueInDays: 10 },
          { label: "Cuota 2 · saldo final", amount: 3_000_000, dueInDays: 25 },
        ],
      },
      approval: { at: pastOf(at(base, -4, 15, 0), now), byName: contactNameOf(signedEvent.clientId), method: "digital", ip: "190.10.20.77", userAgent: "Mozilla/5.0 (LedBox Demo)", note: "Aprobado y firmado desde el portal." },
      token: "F1RM-4D0S-8NQB-3K7M-ZT5R",
      tokenCreatedAt: at(base, -7, 10, 0),
      createdAt: at(base, -8, 10, 0),
      items: [
        { id: "demo_budget_item_fir1", name: "Pantalla LED P5 outdoor 960x960", quantity: 10, days: 1, unitPrice: 800_000, costPrice: 320_000, inventoryId: "demo_inv_led_p5" },
        { id: "demo_budget_item_fir2", name: "Transmisión en vivo y streaming", quantity: 1, days: 1, unitPrice: 2_500_000, costPrice: 1_000_000 },
      ],
    },
    {
      id: "demo_budget_pagado_retenido",
      event: pastFiller,
      title: "Tótems Touch · showroom (cobrado y cerrado)",
      status: "APPROVED",
      discount: 0,
      validUntil: at(base, -40, 18),
      notes: "Cobrado por completo. Un tótem volvió con la pantalla rayada: se retuvo parte del depósito.",
      securityDeposit: { amount: 1_500_000, status: "KEPT_PARTIAL", retained: 500_000 },
      plan: { advance: 2_750_000, terms: "Anticipo del 50% y saldo contra entrega.", installments: [{ label: "Saldo contra entrega", amount: 2_750_000, dueAt: pastOf(at(base, -30, 12, 0), now) }] },
      approval: { at: pastOf(at(base, -52, 11, 0), now), byName: contactNameOf(pastFiller.clientId), method: "manual", note: "Aprobado por correo." },
      createdAt: at(base, -58, 10, 0),
      items: [
        { id: "demo_budget_item_pag1", name: "Tótem Touch 43\"", quantity: 2, days: 2, unitPrice: 1_200_000, costPrice: 450_000, inventoryId: "demo_inv_totem_touch" },
        { id: "demo_budget_item_pag2", name: "Operación técnica", quantity: 1, days: 2, unitPrice: 350_000, costPrice: 140_000 },
      ],
    },
    {
      id: "demo_budget_archivado",
      clientId: "demo_client_lg",
      title: "Showroom de electrodomésticos (propuesta anterior)",
      status: "LOST",
      discount: 0,
      validUntil: at(base, -75, 18),
      notes: "El cliente eligió otra propuesta. Se archivó para no ensuciar la lista.",
      createdAt: at(base, -90, 10, 0),
      lifecycle: { archivedAt: at(base, -60, 10, 0) },
      items: [{ id: "demo_budget_item_arc1", name: "Pantalla LED P3.9 500x500", quantity: 4, days: 3, unitPrice: 450_000, costPrice: 180_000 }],
    },
    {
      id: "demo_budget_eliminado",
      clientId: "demo_client_cerveza",
      title: "Presupuesto duplicado · ChoppFest",
      status: "DRAFT",
      discount: 0,
      validUntil: at(base, 20, 18),
      notes: "Se cargó dos veces por error; quedó en la papelera.",
      createdAt: at(base, -12, 10, 0),
      lifecycle: { archivedAt: at(base, -6, 9, 0), deletedAt: at(base, -5, 9, 0), deleteReason: "Duplicado del presupuesto de ChoppFest." },
      items: [{ id: "demo_budget_item_eli1", name: "Escenario con pantalla de fondo", quantity: 1, days: 1, unitPrice: 3_200_000, costPrice: 1_400_000 }],
    },
  ];

  // ── Cobros y pagos esperados de los presupuestos nuevos ────────────────────
  const received = (id: string, row: Omit<Prisma.ClientPaymentUncheckedCreateInput, "id" | "organizationId" | "status" | "collectedAt" | "treasuryAccountId">) => ({
    id,
    ...org,
    ...row,
    treasuryAccountId: TREASURY_BANK,
    status: "RECEIVED" as const,
    collectedAt: row.paidAt ?? null,
  });
  const signedAdvanceAt = pastOf(at(base, -4, 15, 30), now);
  const paidAdvanceAt = pastOf(new Date(pastFiller.startsAt.getTime() - 9 * DAY_MS), now);
  const paidBalanceAt = pastOf(new Date(pastFiller.endsAt.getTime() + 1 * DAY_MS), now);
  const payments = [
    received("demo_pay_firmado_anticipo", { clientId: signedEvent.clientId, budgetId: "demo_budget_firmado", amount: 4_000_000, paidAt: signedAdvanceAt, method: "Transferencia", reference: "TRF-88410", notes: "Anticipo del 40% con la firma." }),
    received("demo_pay_pagado_1", { clientId: pastFiller.clientId, budgetId: "demo_budget_pagado_retenido", amount: 2_750_000, paidAt: paidAdvanceAt, method: "Transferencia", reference: "TRF-86020", notes: "Anticipo del 50%." }),
    received("demo_pay_pagado_2", { clientId: pastFiller.clientId, budgetId: "demo_budget_pagado_retenido", amount: 2_750_000, paidAt: paidBalanceAt, method: "Transferencia", reference: "TRF-86377", notes: "Saldo contra entrega." }),
  ];
  const confirmed = (id: string, budgetId: string, label: string, concept: "advance" | "balance", amount: number, payment: { id: string; paidAt: Date }, createdAt: Date): Prisma.ExpectedPaymentUncheckedCreateInput => ({
    id,
    ...org,
    budgetId,
    concept,
    slot: concept,
    installmentNumber: null,
    label,
    amount,
    dueAt: dayStart(dayKeyOf(payment.paidAt)),
    status: "CONFIRMED",
    expectedAccountId: TREASURY_BANK,
    paymentId: payment.id,
    confirmedAt: payment.paidAt,
    confirmedById: SALES.id,
    confirmedByName: SALES.name,
    confirmedByEmail: SALES.email,
    createdAt,
  });
  const expectedPayments: Prisma.ExpectedPaymentUncheckedCreateInput[] = [
    confirmed("demo_expected_firmado_advance", "demo_budget_firmado", "Anticipo", "advance", 4_000_000, { id: "demo_pay_firmado_anticipo", paidAt: signedAdvanceAt }, at(base, -5, 9, 0)),
    {
      id: "demo_expected_firmado_cuota_1", ...org, budgetId: "demo_budget_firmado", concept: "installment", slot: "installment:1", installmentNumber: 1,
      label: "Cuota 1", amount: 3_000_000, dueAt: at(base, 10, 0, 0), status: "AWAITING", expectedAccountId: TREASURY_BANK, createdAt: at(base, -5, 9, 0),
    },
    {
      id: "demo_expected_firmado_cuota_2", ...org, budgetId: "demo_budget_firmado", concept: "installment", slot: "installment:2", installmentNumber: 2,
      label: "Cuota 2 · saldo final", amount: 3_000_000, dueAt: at(base, 25, 0, 0), status: "AWAITING", expectedAccountId: TREASURY_BANK, createdAt: at(base, -5, 9, 0),
    },
    confirmed("demo_expected_pagado_advance", "demo_budget_pagado_retenido", "Anticipo", "advance", 2_750_000, { id: "demo_pay_pagado_1", paidAt: paidAdvanceAt }, at(base, -55, 9, 0)),
    confirmed("demo_expected_pagado_balance", "demo_budget_pagado_retenido", "Saldo contra entrega", "balance", 2_750_000, { id: "demo_pay_pagado_2", paidAt: paidBalanceAt }, at(base, -55, 9, 0)),
  ];

  // ── Proveedores y trabajos: todos los estados y categorías ─────────────────
  const suppliers: Prisma.SupplierUncheckedCreateInput[] = [
    { id: "demo_supplier_staff", ...org, name: "Equipo Brillante", company: "Brillante Personal para Eventos", phone: "+595 983 410 520", email: "personal@ledbox.demo", category: "STAFF", paymentTerms: "50% al confirmar y saldo al cierre", notes: "Azafatas, promotoras y personal de acreditación.", active: true, createdAt: at(base, -100, 9, 0) },
    { id: "demo_supplier_mobiliario", ...org, name: "Mobiliario Ñandutí", company: "Ñandutí Alquiler de Mobiliario", phone: "+595 972 305 118", email: "alquiler@ledbox.demo", category: "FURNITURE", paymentTerms: "Contado contra entrega", notes: "Livings, barras y mesas altas para activaciones.", active: true, createdAt: at(base, -95, 9, 0) },
    { id: "demo_supplier_otros", ...org, name: "Servicios Varios Aquino", company: null, phone: "+595 981 700 311", email: "aquino@ledbox.demo", category: "OTHER", paymentTerms: "Contado", notes: "Limpieza de predio, seguridad y permisos menores.", active: false, createdAt: at(base, -140, 9, 0) },
    { id: "demo_supplier_archivado", ...org, name: "Imprenta Rápida del Centro", company: "Imprenta Rápida S.R.L.", phone: "+595 21 300 777", email: "imprenta@ledbox.demo", category: "GRAPHICS", paymentTerms: "Contado", notes: "Dejó de trabajar con nosotros; se conserva por el historial.", active: false, createdAt: at(base, -200, 9, 0), archivedAt: at(base, -45, 10, 0), ...archivedBy },
    { id: "demo_supplier_eliminado", ...org, name: "Proveedor cargado por error", company: null, phone: null, email: null, category: "OTHER", paymentTerms: null, notes: null, active: false, createdAt: at(base, -30, 9, 0), archivedAt: at(base, -9, 10, 0), ...archivedBy, deletedAt: at(base, -8, 10, 0), deletedById: SALES.id, deleteReason: "Se cargó por error, sin trabajos." },
  ];
  const supplierJobs = [
    { id: "demo_job_staff_anticipo", ...org, supplierId: "demo_supplier_staff", eventId: second.id, category: "STAFF" as const, description: "Promotoras y acreditación · segundo evento", total: 1_800_000, advance: 0, status: "ADVANCE_PENDING" as const, dueAt: at(base, 1, 12, 0), notes: "Falta transferir el anticipo para confirmar al personal." },
    { id: "demo_job_mobiliario_cancelado", ...org, supplierId: "demo_supplier_mobiliario", eventId: cancelled.id, category: "FURNITURE" as const, description: "Livings y barras · pasarela cancelada", total: 2_200_000, advance: 0, status: "CANCELLED" as const, dueAt: at(base, 10, 12, 0), notes: "Cancelado junto con el evento; sin costo para nosotros." },
  ];

  // ── Clientes, oportunidades, promotoras y eventos archivados/eliminados ────
  const consentAt = at(base, -40, 10, 0);
  const clients: Prisma.ClientUncheckedCreateInput[] = [
    { id: "demo_client_archivado", ...org, type: "FINAL", name: "Inés Barrios", company: "Distribuidora Ñandú", contactName: "Inés Barrios", email: "ines.barrios@ledbox.demo", contactEmail: "ines.barrios@ledbox.demo", phone: "+595 981 200 410", contactPhone: "+595 981 200 410", notes: "Dejó de pedir; archivada para no mezclarla con los clientes activos.", active: false, createdAt: at(base, -180, 9, 0), archivedAt: at(base, -30, 10, 0), ...archivedBy },
    { id: "demo_client_eliminado", ...org, type: "FINAL", name: "Cliente de prueba", company: null, email: "prueba@ledbox.demo", phone: "+595 981 000 000", notes: "Cargado para probar el alta.", active: false, createdAt: at(base, -50, 9, 0), archivedAt: at(base, -20, 10, 0), ...archivedBy, deletedAt: at(base, -19, 10, 0), deletedById: SALES.id, deleteReason: "Era un cliente de prueba." },
  ];
  const leads: Prisma.LeadUncheckedCreateInput[] = [
    { id: "demo_lead_archivado", ...org, name: "Néstor Villamayor", phone: "+595 982 118 900", email: "nestor.villamayor@ledbox.demo", company: "Villamayor Eventos", reason: "Cotización de pantallas", message: "Consulta de precios para un cumpleaños de 15; después no respondió.", internalNotes: "Sin respuesta tras tres intentos.", source: "website", consentAt, consentChannel: "sitio-web", consentVersion: "2025-1", status: "LOST", createdAt: at(base, -70, 10, 0), archivedAt: at(base, -40, 10, 0), ...archivedBy },
    { id: "demo_lead_eliminado", ...org, name: "Consulta repetida", phone: "+595 981 000 111", email: "repetida@ledbox.demo", reason: "Consulta", message: "Mismo pedido enviado dos veces.", source: "website", consentAt, consentChannel: "sitio-web", consentVersion: "2025-1", status: "NEW", createdAt: at(base, -15, 10, 0), archivedAt: at(base, -10, 10, 0), ...archivedBy, deletedAt: at(base, -9, 10, 0), deletedById: SALES.id, deleteReason: "Duplicado de otra consulta." },
  ];
  const promoters: Prisma.PromoterUncheckedCreateInput[] = [
    { id: "demo_promoter_archivada", ...org, name: "Rocío Martínez", phone: "+595 984 330 912", email: "rocio.martinez@ledbox.demo", specialties: "Degustación y atención de stand", active: false, notes: "Ya no trabaja con nosotros.", availability: "UNAVAILABLE", availabilityNote: "Dejó el equipo.", createdAt: at(base, -160, 10, 0), archivedAt: at(base, -50, 10, 0), ...archivedBy },
    { id: "demo_promoter_eliminada", ...org, name: "Promotora de prueba", phone: null, email: null, specialties: null, active: false, notes: null, availability: "TO_DEFINE", createdAt: at(base, -25, 10, 0), archivedAt: at(base, -12, 10, 0), ...archivedBy, deletedAt: at(base, -11, 10, 0), deletedById: SALES.id, deleteReason: "Alta de prueba." },
  ];
  const events: Prisma.EventUncheckedCreateInput[] = [
    { id: "demo_event_archivado_lg", ...org, clientId: "demo_client_lg", name: "Showroom LG · Día del Padre", location: "Paseo La Galería, Asunción", setupAt: at(base, -81, 8, 0), startsAt: at(base, -80, 14, 0), endsAt: at(base, -78, 21, 0), strikeAt: at(base, -77, 9, 0), status: "COMPLETED", notes: "Evento cerrado y cobrado; se archivó para despejar la agenda.", createdAt: at(base, -100, 10, 0), archivedAt: at(base, -60, 10, 0), ...archivedBy },
    { id: "demo_event_eliminado_prueba", ...org, clientId: "demo_client_cerveza", name: "Evento de prueba", location: null, startsAt: at(base, 30, 18, 0), endsAt: at(base, 30, 23, 0), status: "DRAFT", notes: "Cargado para probar la agenda.", createdAt: at(base, -14, 10, 0), archivedAt: at(base, -8, 10, 0), ...archivedBy, deletedAt: at(base, -7, 10, 0), deletedById: SALES.id, deleteReason: "Evento de prueba cargado por error." },
  ];
  // Mayorista con el link revocado (la ficha muestra «Acceso revocado»).
  const catalogTokens: Prisma.CatalogAccessTokenUncheckedCreateInput[] = [
    { id: "demo_catalog_access_puntocreativo_revocado", ...org, clientId: "demo_client_puntocreativo", tokenHash: sha256Hex(tk("demo-link-mayorista-revocado-puntocreativo")), createdAt: at(base, -60, 10, 0), revokedAt: at(base, -35, 10, 0), lastUsedAt: at(base, -40, 15, 0) },
  ];

  // ── Inventario ─────────────────────────────────────────────────────────────
  const inventoryItems: InventoryItemInput[] = [
    { id: "demo_inv_microfono", name: "Micrófono inalámbrico de mano", category: "Sonido", sku: "MIC-INAL", kind: "REUSABLE", status: "IN_USE", quantity: 4, replacementCost: 1_400_000, dailyCost: 30_000, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 180_000, wholesalePrice: 140_000, minimumPrice: 120_000, notes: "Los cuatro están afuera en la activación en curso: sin stock hasta que vuelvan.", createdAt: at(base, -120, 9, 0) },
    { id: "demo_inv_generador", name: "Generador eléctrico 5 kVA", category: "Energía", sku: "GEN-5KVA", kind: "REUSABLE", status: "RESERVED", quantity: 3, replacementCost: 6_500_000, dailyCost: 220_000, visibleOnWeb: true, catalogAudience: "RETAIL", listPrice: 1_200_000, minimumPrice: 950_000, notes: "Los tres reservados para el próximo evento confirmado.", createdAt: at(base, -110, 9, 0) },
    { id: "demo_inv_proyector", name: "Proyector láser 6000 lm", category: "Video", sku: "PRY-6000", kind: "REUSABLE", status: "MAINTENANCE", quantity: 3, replacementCost: 9_800_000, dailyCost: 260_000, notes: "Los tres fuera de circulación: uno en reparación, uno dañado y uno en limpieza de óptica.", createdAt: at(base, -130, 9, 0) },
    { id: "demo_inv_soporte_led", name: "Soporte de pared para LED", category: "Estructuras", sku: "SOP-LED", kind: "REUSABLE", status: "AVAILABLE", quantity: 4, replacementCost: 380_000, dailyCost: 8_000, visibleOnWeb: true, catalogAudience: "WHOLESALE", listPrice: 90_000, wholesalePrice: 70_000, notes: "Una unidad se dio de baja (ver incidentes).", createdAt: at(base, -100, 9, 0) },
    { id: "demo_inv_kit_activacion", name: "Kit activación de marca", category: "Combos", sku: "KIT-ACT", kind: "REUSABLE", status: "AVAILABLE", quantity: 0, replacementCost: 0, dailyCost: 0, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 3_900_000, wholesalePrice: 3_400_000, minimumPrice: 3_300_000, notes: "Tótem touch, dispensador de premios y dos cilindros LED.", createdAt: at(base, -20, 9, 0) },
    { id: "demo_inv_led_p10", name: "Pantalla LED P10 (modelo anterior)", category: "Pantallas LED", sku: "LED-P10", kind: "REUSABLE", status: "RETIRED", quantity: 0, replacementCost: 900_000, dailyCost: 0, notes: "Reemplazada por la P3.9; archivada para conservar el historial.", createdAt: at(base, -400, 9, 0), archivedAt: at(base, -12, 10, 0), ...archivedBy },
    { id: "demo_inv_cartel_neon", name: "Cartel de neón LED (duplicado)", category: "Activaciones", sku: "NEO-01", kind: "REUSABLE", status: "AVAILABLE", quantity: 1, replacementCost: 500_000, dailyCost: 15_000, notes: "Estaba cargado dos veces.", createdAt: at(base, -60, 9, 0), archivedAt: at(base, -20, 10, 0), ...archivedBy, deletedAt: at(base, -5, 10, 0), deletedById: SALES.id, deleteReason: "Estaba cargado dos veces." },
  ];

  const unitsOf = (itemId: string, prefix: string, specs: Array<{ status: Prisma.InventoryUnitUncheckedCreateInput["status"]; notes?: string; cost?: number }>, cost: number) =>
    specs.map((spec, index): Prisma.InventoryUnitUncheckedCreateInput => ({
      id: `demo_unit_${itemId.replace(/^demo_inv_/, "")}_${index + 1}`,
      organizationId,
      inventoryId: itemId,
      code: `${prefix}-${String(index + 1).padStart(2, "0")}`,
      status: spec.status,
      purchaseCost: spec.cost ?? cost,
      notes: spec.notes ?? null,
      createdAt: at(base, -120, 9, 0),
    }));
  const inventoryUnits = [
    ...unitsOf("demo_inv_microfono", "MIC", [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }], 1_400_000),
    ...unitsOf("demo_inv_generador", "GEN", [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }], 6_500_000),
    ...unitsOf(
      "demo_inv_proyector",
      "PRY",
      [
        { status: "MAINTENANCE", notes: "En reparación: cambio del módulo láser." },
        { status: "DAMAGED", notes: "Lente rajado en el traslado; pendiente de presupuesto." },
        { status: "MAINTENANCE", notes: "Limpieza de óptica por polvo del predio." },
      ],
      9_800_000,
    ),
    ...unitsOf("demo_inv_soporte_led", "SOP", [{ status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "AVAILABLE" }, { status: "RETIRED", notes: "Dada de baja: se deformó y no se puede reparar." }], 380_000),
    ...unitsOf("demo_inv_led_p10", "PNL", [{ status: "RETIRED", notes: "Retirada del servicio." }, { status: "RETIRED", notes: "Retirada del servicio." }], 900_000),
    ...unitsOf("demo_inv_cartel_neon", "NEO", [{ status: "AVAILABLE" }], 500_000),
  ];

  const inventoryComponents: Prisma.InventoryComponentUncheckedCreateInput[] = [
    { parent: "demo_inv_kit_activacion", component: "demo_inv_totem_touch", quantity: 1 },
    { parent: "demo_inv_kit_activacion", component: "demo_inv_dispenser", quantity: 1 },
    { parent: "demo_inv_kit_activacion", component: "demo_inv_cilindro", quantity: 2 },
  ].map((row) => ({
    id: `demo_combo_${row.parent.replace(/^demo_inv_/, "")}_${row.component.replace(/^demo_inv_/, "")}`,
    organizationId,
    parentId: row.parent,
    componentId: row.component,
    quantity: row.quantity,
    createdAt: at(base, -20, 9, 0),
  }));

  const nextEnd = new Date(next.strikeAt.getTime() + 5 * 60 * 60_000);
  const assignments: Prisma.EventInventoryUncheckedCreateInput[] = [
    // Agotado hoy: los cuatro micrófonos salieron a la activación en curso.
    { id: "demo_asg_activacion_microfono", organizationId, eventId: inProgress.id, inventoryId: "demo_inv_microfono", quantity: 4, startsAt: at(base, -1, 8, 0), endsAt: at(base, 4, 22, 0), checkedOut: true, checkedIn: false, checkedOutAt: at(base, -1, 8, 40), conditionOut: "Bueno", checkoutQuantity: 4, checkedOutById: SALES.id, checkoutNote: "Retiró el técnico de la activación (dato simulado)." },
    // Agotado en un rango: los tres generadores van firmes al próximo evento.
    { id: "demo_asg_proximo_generador", organizationId, eventId: next.id, inventoryId: "demo_inv_generador", quantity: 3, startsAt: next.setupAt, endsAt: nextEnd, checkedOut: false, checkedIn: false },
    // Devolución cerrada con daño: dos proyectores salieron y volvieron, uno con el lente rajado.
    { id: "demo_asg_feria_proyector", organizationId, eventId: recentPast.id, inventoryId: "demo_inv_proyector", quantity: 2, startsAt: recentPast.setupAt, endsAt: recentPast.strikeAt, checkedOut: true, checkedIn: true, checkedOutAt: new Date(recentPast.setupAt.getTime() + 20 * 60_000), checkedInAt: new Date(recentPast.strikeAt.getTime() + 90 * 60_000), conditionOut: "Bueno", conditionIn: "Con daño: lente rajado", checkoutQuantity: 2, returnedQuantity: 2, damagedQuantity: 1, missingQuantity: 0, damageNotes: "Un proyector volvió con el lente rajado; queda fuera de circulación." },
    // Devolución cerrada sin novedades.
    { id: "demo_asg_showroom_kiosko", organizationId, eventId: pastFiller.id, inventoryId: "demo_inv_kiosko", quantity: 2, startsAt: pastFiller.setupAt, endsAt: pastFiller.strikeAt, checkedOut: true, checkedIn: true, checkedOutAt: new Date(pastFiller.setupAt.getTime() + 30 * 60_000), checkedInAt: new Date(pastFiller.strikeAt.getTime() + 60 * 60_000), conditionOut: "Bueno", conditionIn: "Bueno", checkoutQuantity: 2, returnedQuantity: 2 },
  ];

  const incidents: Prisma.InventoryIncidentUncheckedCreateInput[] = [
    { id: "demo_inc_proyector_lente", organizationId, inventoryId: "demo_inv_proyector", assignmentId: "demo_asg_feria_proyector", eventId: recentPast.id, unitId: "demo_unit_proyector_2", kind: "DAMAGE", quantity: 1, status: "OPEN", cost: null, notes: "Lente rajado en el traslado; falta el presupuesto de reparación.", openedAt: new Date(recentPast.strikeAt.getTime() + 95 * 60_000) },
    { id: "demo_inc_proyector_laser", organizationId, inventoryId: "demo_inv_proyector", unitId: "demo_unit_proyector_1", kind: "REPAIR", quantity: 1, status: "IN_REPAIR", cost: 1_250_000, notes: "Cambio del módulo láser en el servicio técnico (dato simulado).", openedAt: at(base, -9, 10, 0) },
    { id: "demo_inc_proyector_limpieza", organizationId, inventoryId: "demo_inv_proyector", unitId: "demo_unit_proyector_3", kind: "CLEANING", quantity: 1, status: "OPEN", cost: null, notes: "Limpieza de óptica por polvo del predio.", openedAt: at(base, -3, 9, 0) },
    // Unidades dañadas del dataset base que no tenían su incidente: el estado de la unidad siempre se explica.
    { id: "demo_inc_totem_base", organizationId, inventoryId: "demo_inv_totem", eventId: recentPast.id, unitId: "demo_unit_totem_2", kind: "DAMAGE", quantity: 1, status: "OPEN", cost: null, notes: "Base rajada en el traslado; pendiente de presupuesto de reparación.", openedAt: new Date(recentPast.strikeAt.getTime() + 30 * 60_000) },
    { id: "demo_inc_mezcladora_fader", organizationId, inventoryId: "demo_inv_mezcladora", unitId: "demo_unit_mezcladora_2", kind: "DAMAGE", quantity: 1, status: "OPEN", cost: null, notes: "Fader del canal 3 dañado; pendiente de presupuesto de reparación.", openedAt: at(base, -12, 11, 0) },
    // Resueltos y dados de baja: historia cerrada.
    { id: "demo_inc_kiosko_pantalla", organizationId, inventoryId: "demo_inv_kiosko", unitId: "demo_unit_kiosko_1", kind: "REPAIR", quantity: 1, status: "RESOLVED", cost: 180_000, notes: "Cambio de la pantalla táctil; volvió a circulación.", openedAt: at(base, -40, 10, 0), resolvedAt: at(base, -33, 16, 0), resolvedById: SALES.id },
    { id: "demo_inc_cilindro_golpe", organizationId, inventoryId: "demo_inv_cilindro", unitId: "demo_unit_cilindro_1", eventId: pastFiller.id, kind: "DAMAGE", quantity: 1, status: "RESOLVED", cost: 95_000, notes: "Golpe en una esquina; se reparó con el proveedor y el cliente lo cubrió.", openedAt: at(base, -36, 11, 0), resolvedAt: at(base, -30, 15, 0), resolvedById: SALES.id },
    { id: "demo_inc_soporte_baja", organizationId, inventoryId: "demo_inv_soporte_led", unitId: "demo_unit_soporte_led_5", kind: "DAMAGE", quantity: 1, status: "WRITTEN_OFF", cost: 380_000, notes: "Se deformó y no se puede reparar: se dio de baja y se cobró la reposición.", openedAt: at(base, -50, 10, 0), resolvedAt: at(base, -44, 12, 0), resolvedById: SALES.id },
  ];

  return {
    budgetSeeds,
    payments,
    expectedPayments,
    supplierJobs,
    suppliers,
    clients,
    leads,
    promoters,
    events,
    inventoryItems: inventoryItems.map((item) => ({ ...item, organizationId })),
    inventoryUnits,
    inventoryComponents,
    assignments,
    incidents,
    catalogTokens,
  };
}

// ── Firmas ──────────────────────────────────────────────────────────────────

type SigStatus = "DRAFT" | "SENT" | "VIEWED" | "SIGNED" | "VALIDATED" | "REJECTED" | "EXPIRED" | "CANCELLED";

type SigSpec = {
  key: string;
  budgetId: string;
  status: SigStatus;
  title: string;
  /** Días atrás en que se creó la solicitud. */
  daysAgo: number;
  reason?: string;
  otp?: boolean;
};

const SIGNATURE_SPECS: readonly SigSpec[] = [
  { key: "firmado", budgetId: "demo_budget_firmado", status: "VALIDATED", title: "Presupuesto aprobado · Marco Antonio Solís", daysAgo: 5 },
  { key: "pagado", budgetId: "demo_budget_pagado_retenido", status: "SIGNED", title: "Presupuesto · showroom de tótems Touch", daysAgo: 55 },
  { key: "aprobado", budgetId: "demo_budget_aprobado", status: "VIEWED", title: "Presupuesto de producción integral", daysAgo: 2 },
  { key: "sin_evento", budgetId: "demo_budget_sin_evento", status: "SENT", title: "Presupuesto aprobado a la espera del evento", daysAgo: 1 },
  { key: "mora", budgetId: "demo_budget_mora", status: "REJECTED", title: "Presupuesto de la activación", daysAgo: 18, reason: "Hay que corregir la razón social antes de firmar." },
  { key: "hist_sep", budgetId: "demo_budget_hist_sep", status: "EXPIRED", title: "Presupuesto Feria de la Vivienda", daysAgo: 40 },
  { key: "hist_ago", budgetId: "demo_budget_hist_ago", status: "CANCELLED", title: "Presupuesto del lanzamiento", daysAgo: 30, reason: "Se reemplazó por una versión corregida del documento." },
  { key: "mayorista", budgetId: "demo_budget_mayorista", status: "DRAFT", title: "Presupuesto mayorista (borrador de firma)", daysAgo: 0 },
];

/** Presupuestos con solicitud de firma: el seed necesita ya insertados para calcular las huellas. */
export const SIGNATURE_BUDGET_IDS = SIGNATURE_SPECS.map((spec) => spec.budgetId);

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Código público determinístico del alfabeto sin ambigüedades (`XXXX-XXXX-XXXX-XXXX-XXXX`). */
function demoSignatureCode(seed: string, salt?: string): string {
  const digest = sha256Hex(salt ? `demo-codigo-firma:${seed}:${salt}` : `demo-codigo-firma:${seed}`);
  let compact = "";
  for (let i = 0; i < 20; i += 1) compact += ALPHABET[parseInt(digest.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  return compact.match(/.{4}/g)!.join("-");
}

type SigEventPlan = { type: Prisma.SignatureEventUncheckedCreateInput["eventType"]; status: SigStatus | "PENDING_SIGNATURE" | "SIGNING"; actor: "SYSTEM" | "ADMIN" | "CLIENT"; minutes: number; metadata?: Record<string, unknown> };

function planFor(spec: SigSpec): SigEventPlan[] {
  const created: SigEventPlan = { type: "REQUEST_CREATED", status: "DRAFT", actor: "ADMIN", minutes: 0 };
  const sent: SigEventPlan[] = [{ type: "EMAIL_SENT", status: "SENT", actor: "SYSTEM", minutes: 2 }];
  const viewed: SigEventPlan = { type: "VIEWED", status: "VIEWED", actor: "CLIENT", minutes: 190 };
  const signing: SigEventPlan[] = [
    { type: "CONSENT_ACCEPTED", status: "PENDING_SIGNATURE", actor: "CLIENT", minutes: 196 },
    { type: "SIGNING_STARTED", status: "SIGNING", actor: "CLIENT", minutes: 198 },
    { type: "SIGNATURE_RECEIVED", status: "SIGNED", actor: "CLIENT", minutes: 201 },
    { type: "TIMESTAMP_APPLIED", status: "SIGNED", actor: "SYSTEM", minutes: 201 },
  ];
  switch (spec.status) {
    case "DRAFT":
      return [created];
    case "SENT":
      return [created, ...sent];
    case "VIEWED":
      return [created, ...sent, viewed];
    case "REJECTED":
      return [created, ...sent, viewed, { type: "REJECTED", status: "REJECTED", actor: "CLIENT", minutes: 215, metadata: { reason: spec.reason ?? null } }];
    case "EXPIRED":
      return [created, ...sent, { type: "EXPIRED", status: "EXPIRED", actor: "SYSTEM", minutes: 60 * 24 * 7 }];
    case "CANCELLED":
      return [created, ...sent, { type: "CANCELLED", status: "CANCELLED", actor: "ADMIN", minutes: 60 * 26, metadata: { reason: spec.reason ?? null } }];
    case "SIGNED":
      return [created, ...sent, viewed, ...signing];
    case "VALIDATED":
      return [
        created,
        ...sent,
        viewed,
        ...signing,
        { type: "DOCUMENT_VALIDATED", status: "VALIDATED", actor: "SYSTEM", minutes: 202 },
        { type: "AUDIT_GENERATED", status: "VALIDATED", actor: "SYSTEM", minutes: 203 },
        { type: "COMPLETION_EMAIL_SENT", status: "VALIDATED", actor: "SYSTEM", minutes: 204 },
      ];
  }
}

/**
 * Firmas: una solicitud por estado, con su cadena de auditoría. Se arma después
 * de los presupuestos: el destinatario es la persona de contacto del cliente de
 * cada presupuesto (`recipientOf`), así nunca firma alguien ajeno.
 */
export function buildDemoSignatures(input: {
  organizationId: string;
  base: Date;
  now: Date;
  recipientOf: (budgetId: string) => { name: string; email: string };
  /** Snapshot y huella reales del presupuesto ya insertado (mismo cálculo que la creación real). */
  documentOf: (budgetId: string, title: string) => { snapshot: Record<string, unknown>; hash: string };
  /** Sandbox: reescribe los ids antes de calcular las huellas (la cadena de auditoría las incluye). */
  mapId?: (value: string) => string;
  /** Sandbox: sal del código público de firma (al azar por sandbox). */
  codeSalt?: string;
}) {
  const { organizationId, base, now, recipientOf, documentOf, codeSalt } = input;
  const mapId = input.mapId ?? ((value: string) => value);
  const signatureRequests: Prisma.SignatureRequestUncheckedCreateInput[] = [];
  const signatureEvents: Prisma.SignatureEventUncheckedCreateInput[] = [];
  const signatureEvidence: Prisma.SignatureEvidenceUncheckedCreateInput[] = [];
  const mailLogs: Prisma.MailLogUncheckedCreateInput[] = [];
  const ipHash = sha256Hex("demo-ip:190.10.20.77");
  const uaHash = sha256Hex("demo-ua:LedBox Demo");

  for (const spec of SIGNATURE_SPECS) {
    const id = mapId(`demo_sig_${spec.key}`);
    const recipient = recipientOf(spec.budgetId);
    const createdAt = at(base, -spec.daysAgo, 10, 0);
    const { snapshot: documentSnapshot, hash: documentHash } = documentOf(spec.budgetId, spec.title);
    const plan = planFor(spec).map((step) =>
      step.type === "REQUEST_CREATED"
        ? { ...step, metadata: { documento: `Presupuesto «${spec.title}»`, documentoHash: documentHash, commercialHash: documentHash, documentVersion: SNAPSHOT_DOCUMENT_VERSION, documentSnapshot, documentSnapshotHash: documentHash, metodo: "TYPED", destinatario: recipient.name } }
        : step,
    );
    let previous: string | null = null;
    let lastAt = createdAt;
    const stamps = new Map<string, Date>();
    plan.forEach((step, index) => {
      // Todo el recorrido queda en el pasado, también la solicitud de hoy.
      const occurredAt = pastOf(new Date(Math.max(createdAt.getTime() + step.minutes * 60_000, lastAt.getTime() + 1)), now);
      lastAt = occurredAt;
      stamps.set(step.type, occurredAt);
      const eventId = mapId(`demo_sigev_${spec.key}_${index + 1}`);
      const clientActor = step.actor === "CLIENT";
      const adminActor = step.actor === "ADMIN";
      const core = {
        id: eventId,
        requestId: id,
        eventType: step.type,
        status: step.status,
        occurredAt,
        actorType: step.actor,
        actorId: adminActor ? mapId(SALES.id) : null,
        actorName: adminActor ? SALES.name : clientActor ? recipient.name : null,
        ipHash: clientActor ? ipHash : null,
        userAgentHash: clientActor ? uaHash : null,
        metadataJson: step.metadata ?? null,
      };
      const eventHash = computeSignatureEventHash(core, previous);
      signatureEvents.push({
        id: eventId,
        organizationId,
        requestId: id,
        eventType: step.type,
        status: step.status as Prisma.SignatureEventUncheckedCreateInput["status"],
        occurredAt,
        actorType: step.actor,
        actorId: core.actorId,
        actorName: core.actorName,
        ipHash: core.ipHash,
        userAgentHash: core.userAgentHash,
        metadataJson: (step.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
        previousEventHash: previous,
        eventHash,
      });
      previous = eventHash;
    });

    const signedAt = stamps.get("SIGNATURE_RECEIVED") ?? null;
    const validatedAt = stamps.get("DOCUMENT_VALIDATED") ?? null;
    const identifier = signedAt ? signatureIdentifierFor(signedAt, sha256Hex(`demo-firma:${spec.key}`)) : null;
    const signedHash =
      signedAt && identifier
        ? signedDocumentHash({ documentHash, signatureIdentifier: identifier, signedAt, provider: "local", method: "TYPED", signerName: recipient.name })
        : null;
    const sentAt = stamps.get("EMAIL_SENT") ?? null;
    if (sentAt) {
      // El historial de correo que muestra la columna «Correo» de Firmas.
      mailLogs.push({ id: `demo_mail_firma_${spec.key}`, organizationId, category: "signature", status: "sent", to: recipient.email, subject: `Firmá el documento «${spec.title}»`, error: null, providerId: `demo-firma-${spec.key}`, entity: "SignatureRequest", entityId: id, actorId: mapId(SALES.id), actorName: SALES.name, actorEmail: mapId(SALES.email), sentAt, createdAt: sentAt });
    }
    const expired = spec.status === "EXPIRED";
    signatureRequests.push({
      id,
      organizationId,
      budgetId: mapId(spec.budgetId),
      attachmentId: null,
      publicCode: demoSignatureCode(spec.key, codeSalt),
      title: spec.title,
      senderId: mapId(SALES.id),
      senderName: SALES.name,
      senderEmail: mapId(SALES.email),
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      recipientPhone: null,
      status: spec.status,
      method: "TYPED",
      otpRequired: spec.otp ?? false,
      expiresAt: expired ? at(base, -spec.daysAgo + 7, 10, 0) : at(base, 10, 10, 0),
      sentAt,
      viewedAt: stamps.get("VIEWED") ?? null,
      consentedAt: stamps.get("CONSENT_ACCEPTED") ?? null,
      signedAt,
      validatedAt,
      completedAt: validatedAt ? (stamps.get("COMPLETION_EMAIL_SENT") ?? validatedAt) : null,
      rejectedAt: stamps.get("REJECTED") ?? null,
      rejectionReason: spec.status === "REJECTED" ? (spec.reason ?? null) : null,
      cancelledAt: stamps.get("CANCELLED") ?? null,
      cancelledByName: spec.status === "CANCELLED" ? SALES.name : null,
      cancelReason: spec.status === "CANCELLED" ? (spec.reason ?? null) : null,
      documentHash,
      documentHashCapturedAt: createdAt,
      signedDocumentHash: signedHash,
      signatureProvider: "local",
      signatureIdentifier: identifier,
      createdAt,
    });

    if (signedAt) {
      signatureEvidence.push(
        { id: `demo_sigevid_${spec.key}_firma`, organizationId, requestId: id, type: "SIGNATURE", status: "COMPLETED", storageKey: "typed", mime: null, size: null, data: null, capturedAt: signedAt, providerReference: null, metadataJson: { typedName: recipient.name }, createdAt: signedAt },
        { id: `demo_sigevid_${spec.key}_sello`, organizationId, requestId: id, type: "TIMESTAMP", status: "COMPLETED", storageKey: "local", mime: null, size: null, data: null, capturedAt: signedAt, providerReference: identifier, metadataJson: Prisma.DbNull, createdAt: signedAt },
        { id: `demo_sigevid_${spec.key}_otp`, organizationId, requestId: id, type: "OTP", status: "OPTIONAL", storageKey: null, mime: null, size: null, data: null, capturedAt: null, providerReference: null, metadataJson: Prisma.DbNull, createdAt: signedAt },
      );
    }
    if (validatedAt) {
      signatureEvidence.push({ id: `demo_sigevid_${spec.key}_sello_final`, organizationId, requestId: id, type: "SEAL", status: "COMPLETED", storageKey: "local", mime: null, size: null, data: null, capturedAt: validatedAt, providerReference: signedHash, metadataJson: Prisma.DbNull, createdAt: validatedAt });
    }
  }
  return { signatureRequests, signatureEvents, signatureEvidence, mailLogs };
}
