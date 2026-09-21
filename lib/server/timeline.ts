import type { Prisma } from "@prisma/client";
import {
  budgetStatusLabel,
  damageSummary,
  eventStatusLabel,
  formatBytes,
  formatDate,
  formatMoney,
  formatNumber,
  paymentProofMimeLabel,
  taskTypeLabel,
  type AdminTone,
} from "@/lib/admin-format";
import type { AdminTimelineEntry, AdminTimelineKind } from "@/lib/admin-types";
import { db } from "./db";

/**
 * Cronología de un presupuesto y de un evento (issue #33): fuente única de los
 * hitos que ve el panel (`GET /api/admin/timeline`) y de la versión reducida
 * del portal del cliente.
 *
 * Regla madre: **nada inventado**. Cada hito sale de un registro real —la fila,
 * su auditoría (`AuditLog`), el correo (`MailLog`), el movimiento de tesorería,
 * la asignación de inventario o la tarea— con su fecha real y su actor real; si
 * un hecho no quedó registrado, no aparece. El actor del portal se rotula
 * «Cliente (portal)»; el resto es el nombre denormalizado de la auditoría.
 *
 * La versión cliente (`audience: "client"`) filtra a los hitos de venta y
 * postventa (enviado → cambios → aprobado → pagos/comprobantes → evento →
 * agradecimiento): no salen costos, ni actores internos (van como «LedBox»), ni
 * movimientos de tesorería, ni reservas/checklist de operación.
 */

export type TimelineAudience = "admin" | "client";

/** Nombre visible del cliente en la cronología del panel. */
export const PORTAL_ACTOR = "Cliente (portal)";
/** Nombre visible del equipo en la cronología del portal (nunca la persona). */
export const TEAM_ACTOR = "LedBox";

const MAX_AUDIT_ROWS = 400;
const MAX_MAIL_ROWS = 100;
/** Ventana para no duplicar la resolución de una solicitud con su auditoría. */
const RESOLUTION_WINDOW_MS = 30 * 60_000;

type Draft = {
  id: string;
  at: Date;
  kind: AdminTimelineKind;
  title: string;
  detail: string | null;
  actor: string | null;
  tone: AdminTone;
};

// ── Lectura defensiva de la auditoría ───────────────────────────────────────
// `AuditLog.detail` es Json: se lee sin confiar en la forma (nunca lanza).

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Valor «después» de un campo en `detail.changes` (`null` si no está). */
function changeTo(detail: unknown, field: string): unknown {
  const changes = asRecord(asRecord(detail)?.changes);
  const change = changes ? asRecord(changes[field]) : null;
  return change ? change.to : null;
}

/** Valor «antes» de un campo en `detail.changes` (`null` si no está). */
function changeFrom(detail: unknown, field: string): unknown {
  const changes = asRecord(asRecord(detail)?.changes);
  const change = changes ? asRecord(changes[field]) : null;
  return change ? change.from : null;
}

/** Valor de `detail.fields` (`null` si no está). */
function fieldValue(detail: unknown, field: string): unknown {
  const fields = asRecord(asRecord(detail)?.fields);
  return fields ? fields[field] : null;
}

// ── Filas y auditorías ──────────────────────────────────────────────────────

const AUDIT_SELECT = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  summary: true,
  detail: true,
  actorId: true,
  actorName: true,
  createdAt: true,
} as const;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

/**
 * Auditorías de las entidades que forman la cronología, acotadas por sus ids
 * reales. Sin objetivo no hay consulta: la lista vacía es un resultado válido.
 */
async function loadAuditRows(
  organizationId: string,
  targets: Array<{ entity: string; ids: string[] }>,
): Promise<AuditRow[]> {
  const filters = targets
    .filter((target) => target.ids.length > 0)
    .map((target) => ({ entity: target.entity, entityId: { in: [...new Set(target.ids)] } }));
  if (filters.length === 0) return [];
  return db.auditLog.findMany({
    where: { organizationId, OR: filters },
    orderBy: { createdAt: "asc" },
    take: MAX_AUDIT_ROWS,
    select: AUDIT_SELECT,
  });
}

/** Última auditoría que cumple el filtro, o `null`. */
function findAudit(
  rows: AuditRow[],
  entity: string,
  entityId: string,
  match: (row: AuditRow) => boolean,
): AuditRow | null {
  let found: AuditRow | null = null;
  for (const row of rows) {
    if (row.entity !== entity || row.entityId !== entityId) continue;
    if (match(row)) found = row;
  }
  return found;
}

/**
 * Actor legible del hito. El cliente del portal se rotula siempre
 * «Cliente (portal)» (nunca su nombre ni su IP); para el portal, el equipo va
 * como «LedBox» y la persona interna no se expone.
 */
function actorOf(row: AuditRow | null, audience: TimelineAudience): string | null {
  if (!row) return null;
  const name = row.actorName.trim();
  if (row.actorId === "portal" || name === PORTAL_ACTOR) return PORTAL_ACTOR;
  if (!name) return null;
  return audience === "client" ? TEAM_ACTOR : name;
}

/** Actor para hitos que no vienen de la auditoría (correo, movimiento). */
function actorLabel(name: string | null | undefined, audience: TimelineAudience): string | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  return audience === "client" ? TEAM_ACTOR : text;
}

// ── Presupuesto ─────────────────────────────────────────────────────────────

const BUDGET_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  status: true,
  subtotal: true,
  discount: true,
  total: true,
  validUntil: true,
  notes: true,
  createdAt: true,
  publicToken: true,
  publicTokenCreatedAt: true,
  viewedAt: true,
  approvedAt: true,
  approvedByName: true,
  approvalMethod: true,
  approvalNote: true,
  revisionRequestedAt: true,
  revisionNote: true,
  eventId: true,
  client: { select: { name: true, company: true } },
  changeRequests: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      status: true,
      payload: true,
      note: true,
      responseNote: true,
      requestedByName: true,
      createdAt: true,
      resolvedAt: true,
      resolvedByName: true,
    },
  },
  expectedPayments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      amount: true,
      dueAt: true,
      status: true,
      reviewNote: true,
      reviewedAt: true,
      reviewedByName: true,
      confirmedAt: true,
      confirmedByName: true,
      cancelledAt: true,
      createdAt: true,
      proofId: true,
      /** Cobro que confirmó este esperado (para la traza del cobro real). */
      paymentId: true,
      expectedAccount: { select: { name: true } },
    },
  },
  paymentProofs: {
    orderBy: { createdAt: "asc" },
    select: { id: true, uploadedByName: true, mime: true, size: true, createdAt: true, paymentId: true },
  },
  payments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amount: true,
      status: true,
      paidAt: true,
      collectedAt: true,
      method: true,
      reference: true,
      invoiceNumber: true,
      dueAt: true,
      chequeDate: true,
      createdAt: true,
    },
  },
} as const;

type BudgetRow = Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }>;

const MAIL_SELECT = {
  id: true,
  category: true,
  status: true,
  to: true,
  subject: true,
  error: true,
  actorId: true,
  actorName: true,
  sentAt: true,
} as const;

type MailRow = Prisma.MailLogGetPayload<{ select: typeof MAIL_SELECT }>;

/** Correos del presupuesto y de sus cobros/pagos esperados. */
async function loadMailRows(
  organizationId: string,
  budgetId: string,
  paymentIds: string[],
  expectedIds: string[],
): Promise<MailRow[]> {
  const or: Prisma.MailLogWhereInput[] = [{ entity: "Budget", entityId: budgetId }];
  if (paymentIds.length > 0) or.push({ entity: "ClientPayment", entityId: { in: paymentIds } });
  if (expectedIds.length > 0) or.push({ entity: "ExpectedPayment", entityId: { in: expectedIds } });
  return db.mailLog.findMany({
    where: { organizationId, OR: or },
    orderBy: { sentAt: "asc" },
    take: MAX_MAIL_ROWS,
    select: MAIL_SELECT,
  });
}

/** Un correo enviado (o fallido) del presupuesto, con su destinatario real. */
function mailDraft(row: MailRow, audience: TimelineAudience): Draft {
  const failed = row.status === "failed";
  const title = failed
    ? row.category === "budget"
      ? "El correo del presupuesto no se pudo enviar"
      : "Un correo no se pudo enviar"
    : row.category === "budget"
      ? "Presupuesto enviado por correo"
      : row.category === "reminder"
        ? "Recordatorio de pago enviado"
        : "Correo enviado";
  const detail = [
    `A: ${row.to}`,
    row.subject,
    failed && row.error ? `Motivo: ${row.error}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return {
    id: `mail:${row.id}`,
    at: row.sentAt,
    kind: "sent",
    title,
    detail,
    actor: actorLabel(row.actorName, audience),
    tone: failed ? "danger" : "info",
  };
}

/** Resumen corto de lo que pidió el cliente en una solicitud (sin costos). */
function requestSummary(kind: string, payload: unknown): string | null {
  const data = asRecord(payload);
  if (!data) return null;
  if (kind === "items") {
    const items = Array.isArray(data.items) ? data.items : [];
    return items.length > 0 ? `${formatNumber(items.length)} ítem${items.length === 1 ? "" : "s"} a ajustar` : null;
  }
  if (kind === "discount") {
    const discount = asRecord(data.discount);
    const amount = Number(discount?.amount);
    if (!Number.isFinite(amount)) return null;
    const value = Number(discount?.value);
    const asked = discount?.type === "percent" && Number.isFinite(value) ? `${value} %` : formatMoney(amount);
    return `Rebaja pedida: ${asked} (${formatMoney(amount)})`;
  }
  return asText(data.comment);
}

/**
 * Hitos propios del presupuesto: alta, cambios de estado, correo, vista del
 * portal, solicitudes del cliente, aprobación, plan/pagos, cobros y tesorería.
 */
async function budgetDrafts(budget: BudgetRow, audience: TimelineAudience): Promise<Draft[]> {
  const client = audience === "client";
  const drafts: Draft[] = [];

  const paymentIds = budget.payments.map((payment) => payment.id);
  const expectedIds = budget.expectedPayments.map((expected) => expected.id);
  const proofIds = budget.paymentProofs.map((proof) => proof.id);

  const audits = await loadAuditRows(budget.organizationId, [
    { entity: "Budget", ids: [budget.id] },
    { entity: "ClientPayment", ids: paymentIds },
    { entity: "ExpectedPayment", ids: expectedIds },
    { entity: "BudgetPaymentProof", ids: proofIds },
  ]);
  const budgetAudits = audits.filter((row) => row.entity === "Budget" && row.entityId === budget.id);
  const clientLabel = budget.client.company?.trim() || budget.client.name;

  // Alta: la fecha es la del registro; el actor, el de la auditoría si existe.
  if (!client) {
    const created = budgetAudits.find((row) => row.action === "create") ?? null;
    drafts.push({
      id: `budget-created:${budget.id}`,
      at: budget.createdAt,
      kind: "created",
      title: "Presupuesto creado",
      detail: `${budget.title} · ${clientLabel}`,
      actor: actorOf(created, audience),
      tone: "neutral",
    });
  }

  // Resoluciones de solicitudes y revisiones: se emiten una sola vez (abajo),
  // así que acá se saltean las auditorías que las representan.
  const resolutionMoments = budget.changeRequests
    .filter((request) => request.resolvedAt)
    .map((request) => ({ at: request.resolvedAt as Date, kind: request.kind }));
  const revisionMoments = budget.changeRequests
    .filter((request) => request.kind === "changes")
    .map((request) => request.createdAt);

  function duplicatedResolution(row: AuditRow): boolean {
    if (fieldValue(row.detail, "solicitud")) return true;
    // La reserva del stock al aprobar ya sale como hito de inventario por equipo
    // (el resumen agregado sería un hito duplicado).
    if (Array.isArray(fieldValue(row.detail, "outcome"))) return true;
    // El demo/seed no marca la solicitud en el detalle: además de la cercanía
    // horaria, el resumen tiene que hablar de la solicitud para saltearla.
    if (!/rebaja|solicitud|pedido de cambios/i.test(row.summary)) return false;
    const at = row.createdAt.getTime();
    return resolutionMoments.some((moment) => Math.abs(moment.at.getTime() - at) <= RESOLUTION_WINDOW_MS);
  }

  for (const row of budgetAudits) {
    if (row.action === "create" || row.action === "send") continue;
    // La aprobación y el pedido de cambios tienen su hito propio.
    const to = asText(changeTo(row.detail, "status"));
    if (budget.approvedAt && (to === "APPROVED" || fieldValue(row.detail, "approvalMethod"))) continue;
    if (budget.revisionRequestedAt && fieldValue(row.detail, "revisionNote")) continue;
    if (duplicatedResolution(row)) continue;

    if (row.action === "status" && to) {
      const from = asText(changeFrom(row.detail, "status"));
      if (to === "CANCELLED") {
        if (client) continue;
        drafts.push({
          id: `budget-cancelled:${row.id}`,
          at: row.createdAt,
          kind: "cancelled",
          title: "Presupuesto cancelado",
          detail: row.summary,
          actor: actorOf(row, audience),
          tone: "danger",
        });
        continue;
      }
      if (to === "LOST") {
        if (client) continue;
        drafts.push({
          id: `budget-lost:${row.id}`,
          at: row.createdAt,
          kind: "cancelled",
          title: "Presupuesto perdido",
          detail: row.summary,
          actor: actorOf(row, audience),
          tone: "danger",
        });
        continue;
      }
      drafts.push({
        id: `budget-status:${row.id}`,
        at: row.createdAt,
        kind: "status",
        title: `Estado: ${budgetStatusLabel(from)} → ${budgetStatusLabel(to)}`,
        detail: row.summary,
        actor: actorOf(row, audience),
        tone: to === "APPROVED" ? "ok" : "info",
      });
      continue;
    }

    if (client) continue;
    drafts.push({
      id: `budget-updated:${row.id}`,
      at: row.createdAt,
      kind: "updated",
      title: "Cambio en el presupuesto",
      detail: row.summary,
      actor: actorOf(row, audience),
      tone: "neutral",
    });
  }

  // Link del portal: hito propio solo si la auditoría no lo contó (demo/seed).
  if (!client && budget.publicTokenCreatedAt) {
    const audited = budgetAudits.some(
      (row) =>
        row.action === "update" &&
        Math.abs(row.createdAt.getTime() - budget.publicTokenCreatedAt!.getTime()) <= RESOLUTION_WINDOW_MS,
    );
    if (!audited) {
      drafts.push({
        id: `budget-link:${budget.id}`,
        at: budget.publicTokenCreatedAt,
        kind: "updated",
        title: "Link del portal generado",
        detail: null,
        actor: null,
        tone: "neutral",
      });
    }
  }

  // Correos: la bitácora real del proveedor (enviado, fallido o recordatorio).
  const mails = await loadMailRows(budget.organizationId, budget.id, paymentIds, expectedIds);
  for (const mail of mails) drafts.push(mailDraft(mail, audience));

  // Primera vista del link del portal.
  if (budget.viewedAt) {
    drafts.push({
      id: `budget-viewed:${budget.id}`,
      at: budget.viewedAt,
      kind: "viewed",
      title: "El cliente abrió el link por primera vez",
      detail: null,
      actor: client ? "Vos" : PORTAL_ACTOR,
      tone: "accent",
    });
  }

  // Solicitudes del cliente: pedido y resolución, con lo que pidió.
  for (const request of budget.changeRequests) {
    const summary = requestSummary(request.kind, request.payload);
    drafts.push({
      id: `request:${request.id}`,
      at: request.createdAt,
      kind: "request",
      title: `Solicitud del cliente: ${requestKindLabel(request.kind)}`,
      detail: [request.note, summary].filter((part): part is string => Boolean(part)).join(" · ") || null,
      actor: request.requestedByName.trim() || PORTAL_ACTOR,
      tone: "warn",
    });
    if (request.resolvedAt) {
      const rejected = request.status === "rejected";
      drafts.push({
        id: `request-resolved:${request.id}`,
        at: request.resolvedAt,
        kind: "request_resolved",
        title: rejected ? "Solicitud rechazada por el equipo" : "Solicitud aceptada por el equipo",
        detail: request.responseNote,
        actor: actorLabel(request.resolvedByName, audience),
        tone: rejected ? "danger" : "ok",
      });
    }
  }

  // Aprobación digital o manual, con quién la registró.
  if (budget.approvedAt) {
    const digital = budget.approvalMethod !== "manual";
    const audit = budgetAudits.find(
      (row) => asText(changeTo(row.detail, "status")) === "APPROVED" || fieldValue(row.detail, "approvalMethod"),
    ) ?? null;
    drafts.push({
      id: `budget-approved:${budget.id}`,
      at: budget.approvedAt,
      kind: "approved",
      title: digital ? "Aprobación digital del cliente" : "Aprobación manual del equipo",
      detail: [
        budget.approvedByName ? `Firmado por ${budget.approvedByName}` : null,
        budget.approvalNote,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ") || null,
      actor: digital ? PORTAL_ACTOR : actorOf(audit, audience),
      tone: "ok",
    });
  }

  // Pedido de cambios del equipo (el del cliente entra como solicitud).
  if (budget.revisionRequestedAt) {
    const fromClient = revisionMoments.some(
      (at) => Math.abs(at.getTime() - budget.revisionRequestedAt!.getTime()) <= RESOLUTION_WINDOW_MS,
    );
    if (!fromClient) {
      const audit = budgetAudits.find((row) => fieldValue(row.detail, "revisionNote")) ?? null;
      drafts.push({
        id: `budget-revision:${budget.id}`,
        at: budget.revisionRequestedAt,
        kind: "revision",
        title: "El equipo pidió cambios al cliente",
        detail: budget.revisionNote,
        actor: actorOf(audit, audience),
        tone: "warn",
      });
    }
  }

  // Plan de pagos: cada concepto esperado y su circuito real.
  for (const expected of budget.expectedPayments) {
    drafts.push({
      id: `expected:${expected.id}`,
      at: expected.createdAt,
      kind: "expected",
      title: `${expected.label} · ${formatMoney(expected.amount)}`,
      detail: [
        expected.dueAt ? `Vence el ${formatDate(expected.dueAt)}` : "Sin fecha agendada",
        client ? null : "Esperando la transferencia",
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      actor: null,
      tone: "warn",
    });
    if (expected.reviewedAt && expected.reviewNote) {
      drafts.push({
        id: `expected-review:${expected.id}`,
        at: expected.reviewedAt,
        kind: "proof",
        title: `Comprobante observado: ${expected.label}`,
        detail: expected.reviewNote,
        actor: actorLabel(expected.reviewedByName, audience),
        tone: "warn",
      });
    }
    if (expected.confirmedAt) {
      drafts.push({
        id: `expected-confirmed:${expected.id}`,
        at: expected.confirmedAt,
        kind: "payment",
        title: `Pago confirmado: ${expected.label} · ${formatMoney(expected.amount)}`,
        detail: [
          expected.expectedAccount ? `Acreditado en «${expected.expectedAccount.name}»` : "Acreditado en la cuenta",
          client ? null : expected.confirmedByName ? `Confirmado por ${expected.confirmedByName}` : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · "),
        actor: client ? TEAM_ACTOR : actorLabel(expected.confirmedByName, audience),
        tone: "ok",
      });
    }
    if (expected.cancelledAt && !client) {
      drafts.push({
        id: `expected-cancelled:${expected.id}`,
        at: expected.cancelledAt,
        kind: "cancelled",
        title: `Concepto cancelado del plan: ${expected.label}`,
        detail: null,
        actor: null,
        tone: "neutral",
      });
    }
  }

  // Comprobantes subidos desde el portal (el archivo no sale del panel).
  for (const proof of budget.paymentProofs) {
    drafts.push({
      id: `proof:${proof.id}`,
      at: proof.createdAt,
      kind: "proof",
      title: "Comprobante de pago recibido",
      detail: `${paymentProofMimeLabel(proof.mime)} · ${formatBytes(proof.size)}`,
      actor: `${proof.uploadedByName.trim() || PORTAL_ACTOR}`,
      tone: "info",
    });
  }

  // Cobros reales: a plazo, cobrados o anulados.
  const expectedByPayment = new Map(
    budget.expectedPayments
      .filter((expected) => expected.paymentId)
      .map((expected) => [expected.paymentId as string, expected]),
  );
  for (const payment of budget.payments) {
    const cancelled = payment.status === "CANCELLED";
    const received = payment.status === "RECEIVED";
    const audit = findAudit(
      audits,
      "ClientPayment",
      payment.id,
      (row) => asText(changeTo(row.detail, "status")) === (cancelled ? "CANCELLED" : "RECEIVED"),
    );
    // Un cobro confirmado desde un pago esperado no siempre tiene auditoría
    // propia: el confirmante del esperado es el actor real de ese cobro.
    const linked = expectedByPayment.get(payment.id) ?? null;
    const at = cancelled
      ? (audit?.createdAt ?? payment.collectedAt ?? payment.paidAt ?? payment.createdAt)
      : received
        ? (payment.collectedAt ?? payment.paidAt ?? payment.createdAt)
        : payment.createdAt;
    const detail = [
      payment.method,
      payment.reference ? `Ref. ${payment.reference}` : null,
      payment.invoiceNumber ? `Factura ${payment.invoiceNumber}` : null,
      !received && !cancelled && payment.dueAt ? `Vence el ${formatDate(payment.dueAt)}` : null,
      cancelled ? "Anulado" : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    drafts.push({
      id: `payment:${payment.id}`,
      at,
      kind: cancelled ? "cancelled" : "payment",
      title: cancelled
        ? `Cobro anulado: ${formatMoney(payment.amount)}`
        : received
          ? `Cobro recibido: ${formatMoney(payment.amount)}`
          : `Cobro a plazo: ${formatMoney(payment.amount)}`,
      detail: detail || null,
      actor: actorOf(audit, audience) ?? actorLabel(linked?.confirmedByName, audience),
      tone: cancelled ? "danger" : received ? "ok" : "warn",
    });
  }

  // Movimientos de tesorería generados por los cobros (solo panel).
  if (!client && paymentIds.length > 0) {
    const movements = await db.treasuryMovement.findMany({
      where: { organizationId: budget.organizationId, origin: "client_payment", sourceId: { in: paymentIds } },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true,
        direction: true,
        amount: true,
        occurredAt: true,
        createdByName: true,
        account: { select: { name: true } },
        counterAccount: { select: { name: true } },
      },
    });
    for (const movement of movements) {
      const incoming = movement.direction === "IN";
      drafts.push({
        id: `treasury:${movement.id}`,
        at: movement.occurredAt,
        kind: "treasury",
        title: incoming
          ? `Entró ${formatMoney(movement.amount)} en «${movement.account.name}»`
          : `Salió ${formatMoney(movement.amount)} de «${movement.account.name}»`,
        detail: movement.counterAccount ? `Transferencia a «${movement.counterAccount.name}»` : null,
        actor: actorLabel(movement.createdByName, audience),
        tone: incoming ? "ok" : "neutral",
      });
    }
  }

  return drafts;
}

/** Etiqueta del tipo de solicitud del portal (mismo vocabulario del panel). */
function requestKindLabel(kind: string): string {
  if (kind === "items") return "propuesta de ítems";
  if (kind === "discount") return "pedido de rebaja";
  return "pedido de cambios";
}

// ── Evento ──────────────────────────────────────────────────────────────────

const EVENT_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  location: true,
  status: true,
  setupAt: true,
  startsAt: true,
  endsAt: true,
  strikeAt: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { name: true, company: true } },
  tasks: {
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      type: true,
      title: true,
      dueAt: true,
      completedAt: true,
      promoter: { select: { name: true } },
    },
  },
  assignments: {
    select: {
      id: true,
      quantity: true,
      startsAt: true,
      endsAt: true,
      checkedOutAt: true,
      checkedInAt: true,
      conditionOut: true,
      conditionIn: true,
      damagedQuantity: true,
      missingQuantity: true,
      damageNotes: true,
      inventory: { select: { name: true, sku: true } },
    },
  },
} as const;

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

/** Rango comprometido de una asignación, en una línea. */
function assignmentRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return "sin fechas";
  if (start && !end) return `desde el ${formatDate(start)}`;
  if (!start && end) return `hasta el ${formatDate(end)}`;
  return `${formatDate(start)} → ${formatDate(end)}`;
}

/**
 * Hitos de un evento: alta, cambios de estado, fechas reales (montaje, inicio,
 * fin y desmontaje), checklist y equipos (reserva, salida y devolución).
 * Para el cliente quedan solo las fechas, la cancelación y el agradecimiento.
 */
function eventDrafts(event: EventRow, audits: AuditRow[], audience: TimelineAudience): Draft[] {
  const client = audience === "client";
  const drafts: Draft[] = [];
  const eventAudits = audits.filter((row) => row.entity === "Event" && row.entityId === event.id);
  const statusAudits = eventAudits.filter((row) => row.action === "status");

  if (!client) {
    drafts.push({
      id: `event-created:${event.id}`,
      at: event.createdAt,
      kind: "created",
      title: "Evento creado",
      detail: [event.name, event.location].filter((part): part is string => Boolean(part)).join(" · "),
      actor: actorOf(eventAudits.find((row) => row.action === "create") ?? null, audience),
      tone: "neutral",
    });
  }

  for (const row of statusAudits) {
    const to = asText(changeTo(row.detail, "status"));
    if (to === "CANCELLED") {
      drafts.push({
        id: `event-cancelled:${row.id}`,
        at: row.createdAt,
        kind: "cancelled",
        title: "Evento cancelado",
        detail: row.summary,
        actor: actorOf(row, audience),
        tone: "danger",
      });
      continue;
    }
    if (client) continue;
    drafts.push({
      id: `event-status:${row.id}`,
      at: row.createdAt,
      kind: "status",
      title: `Estado: ${eventStatusLabel(asText(changeFrom(row.detail, "status")))} → ${eventStatusLabel(to)}`,
      detail: row.summary,
      actor: actorOf(row, audience),
      tone: to === "COMPLETED" ? "ok" : "info",
    });
  }

  // Cancelado sin auditoría: el registro lo dice; la única fecha real es la
  // última modificación de la fila (no se inventa una fecha de cancelación).
  if (event.status === "CANCELLED" && statusAudits.length === 0) {
    drafts.push({
      id: `event-cancelled:${event.id}`,
      at: event.updatedAt,
      kind: "cancelled",
      title: "Evento cancelado",
      detail: null,
      actor: null,
      tone: "danger",
    });
  }

  // Fechas reales del evento: montaje, inicio, fin y desmontaje.
  const dates: Array<{ label: string; at: Date | null; hint: string }> = [
    { label: "Montaje", at: event.setupAt, hint: "Preparación y montaje" },
    { label: "Inicio", at: event.startsAt, hint: "Comienzo del evento" },
    { label: "Fin", at: event.endsAt, hint: "Cierre del evento" },
    { label: "Desmontaje", at: event.strikeAt, hint: "Retiro de equipos" },
  ];
  for (const date of dates) {
    if (!date.at) continue;
    drafts.push({
      id: `event-date:${event.id}:${date.label}`,
      at: date.at,
      kind: "event_date",
      title: date.label,
      detail: [event.name, event.location, client ? null : date.hint]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      actor: null,
      tone: "accent",
    });
  }

  if (client) {
    // Agradecimiento real: solo cuando el evento quedó finalizado.
    if (event.status === "COMPLETED") {
      drafts.push({
        id: `event-thanks:${event.id}`,
        at: event.strikeAt ?? event.endsAt ?? event.updatedAt,
        kind: "thanks",
        title: "¡Gracias por confiar en LedBox!",
        detail: `Evento «${event.name}» finalizado`,
        actor: null,
        tone: "ok",
      });
    }
    return drafts;
  }

  // Checklist: alta (auditada) y cumplimiento real de cada tarea.
  for (const task of event.tasks) {
    const created = findAudit(audits, "EventTask", task.id, (row) => row.action === "create");
    if (created) {
      drafts.push({
        id: `task:${task.id}`,
        at: created.createdAt,
        kind: "task",
        title: `Tarea creada: ${task.title}`,
        detail: [
          taskTypeLabel(task.type),
          task.promoter?.name,
          task.dueAt ? `Vence el ${formatDate(task.dueAt)}` : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · "),
        actor: actorOf(created, audience),
        tone: "neutral",
      });
    }
    if (task.completedAt) {
      const done = findAudit(
        audits,
        "EventTask",
        task.id,
        (row) => row.action === "status" && Boolean(changeTo(row.detail, "completedAt")),
      );
      drafts.push({
        id: `task-done:${task.id}`,
        at: task.completedAt,
        kind: "task_done",
        title: `Tarea cumplida: ${task.title}`,
        detail: [taskTypeLabel(task.type), task.promoter?.name].filter((part): part is string => Boolean(part)).join(" · "),
        actor: actorOf(done, audience),
        tone: "ok",
      });
    }
  }

  // Equipos: reserva, salida y devolución con sus fechas y novedades reales.
  for (const assignment of event.assignments) {
    const name = assignment.inventory.name;
    const created = findAudit(audits, "EventInventory", assignment.id, (row) => row.action === "create");
    if (created) {
      drafts.push({
        id: `reserve:${assignment.id}`,
        at: created.createdAt,
        kind: "inventory",
        title: `Equipo reservado: ${name} (${formatNumber(assignment.quantity)} u.)`,
        detail: [
          assignment.inventory.sku,
          assignmentRange(assignment.startsAt ?? event.setupAt, assignment.endsAt ?? event.strikeAt),
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · "),
        actor: actorOf(created, audience),
        tone: "info",
      });
    }
    if (assignment.checkedOutAt) {
      const audit = findAudit(audits, "EventInventory", assignment.id, (row) => row.action === "checkout");
      drafts.push({
        id: `checkout:${assignment.id}`,
        at: assignment.checkedOutAt,
        kind: "checkout",
        title: `Salida: ${name} (${formatNumber(assignment.quantity)} u.)`,
        detail: assignment.conditionOut ? `Estado al retirar: ${assignment.conditionOut}` : null,
        actor: actorOf(audit, audience),
        tone: "accent",
      });
    }
    if (assignment.checkedInAt) {
      const audit = findAudit(audits, "EventInventory", assignment.id, (row) => row.action === "checkin");
      const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
      drafts.push({
        id: `checkin:${assignment.id}`,
        at: assignment.checkedInAt,
        kind: "checkin",
        title: `Devolución: ${name} (${formatNumber(assignment.quantity)} u.)`,
        detail: [
          assignment.conditionIn ? `Estado al devolver: ${assignment.conditionIn}` : null,
          damages,
          assignment.damageNotes,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ") || null,
        actor: actorOf(audit, audience),
        tone: damages ? "warn" : "ok",
      });
    }
  }

  return drafts;
}

// ── Armado público ──────────────────────────────────────────────────────────

/** Hitos que ve el cliente en el portal (venta y postventa, sin operación). */
const CLIENT_KINDS: ReadonlySet<AdminTimelineKind> = new Set([
  "sent",
  "viewed",
  "request",
  "request_resolved",
  "approved",
  "revision",
  "expected",
  "proof",
  "payment",
  "event_date",
  "cancelled",
  "thanks",
]);

/** Orden estable por fecha real; los empates conservan el orden de origen. */
function toEntries(drafts: Draft[], audience: TimelineAudience): AdminTimelineEntry[] {
  return drafts
    .filter((draft) => (audience === "client" ? CLIENT_KINDS.has(draft.kind) : true))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((draft) => ({
      id: draft.id,
      at: draft.at.toISOString(),
      kind: draft.kind,
      title: draft.title,
      detail: draft.detail,
      actor: draft.actor,
      tone: draft.tone,
    }));
}

/**
 * Cronología de un presupuesto de la empresa: venta, portal, cobros, tesorería
 * y los hitos operativos de su evento. Devuelve `null` si el presupuesto no
 * existe en esa empresa (la API responde 404 y el portal nunca lo alcanza).
 */
export async function buildBudgetTimeline(
  organizationId: string,
  budgetId: string,
  options: { audience?: TimelineAudience } = {},
): Promise<AdminTimelineEntry[] | null> {
  const audience = options.audience ?? "admin";
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: BUDGET_SELECT,
  });
  if (!budget) return null;

  const drafts = await budgetDrafts(budget, audience);

  if (budget.eventId) {
    const event = await db.event.findFirst({
      where: { id: budget.eventId, organizationId },
      select: EVENT_SELECT,
    });
    if (event) {
      const audits = await loadAuditRows(organizationId, [
        { entity: "Event", ids: [event.id] },
        { entity: "EventTask", ids: event.tasks.map((task) => task.id) },
        { entity: "EventInventory", ids: event.assignments.map((assignment) => assignment.id) },
      ]);
      drafts.push(...eventDrafts(event, audits, audience));
    }
  }

  return toEntries(drafts, audience);
}

/**
 * Cronología de un evento de la empresa: alta, estados, fechas, checklist y
 * equipos. Devuelve `null` si el evento no existe en esa empresa.
 */
export async function buildEventTimeline(
  organizationId: string,
  eventId: string,
  options: { audience?: TimelineAudience } = {},
): Promise<AdminTimelineEntry[] | null> {
  const audience = options.audience ?? "admin";
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId },
    select: EVENT_SELECT,
  });
  if (!event) return null;

  const audits = await loadAuditRows(organizationId, [
    { entity: "Event", ids: [event.id] },
    { entity: "EventTask", ids: event.tasks.map((task) => task.id) },
    { entity: "EventInventory", ids: event.assignments.map((assignment) => assignment.id) },
  ]);
  return toEntries(eventDrafts(event, audits, audience), audience);
}
