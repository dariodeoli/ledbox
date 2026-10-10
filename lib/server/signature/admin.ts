import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { emailValid, normalizeEmail, normalizePhone, phoneValid } from "@/lib/field-rules";
import { signaturePortalUrl } from "@/lib/public-config";
import { db } from "../db";
import { recordAudit } from "../audit";
import { sendMail } from "../mail";
import { buildSignatureRequestMail } from "../mail/signature";
import type { AdminContext } from "../tenancy";
import type { AdminSignatureRequestRow } from "@/lib/admin-types";
import { appendSignatureEvent, lockSignatureRequest } from "./events";
import { attachmentDocumentHash, budgetDocumentHash, budgetDocumentPayload, signatureDocument, signatureBudgetSelect, SNAPSHOT_DOCUMENT_VERSION } from "./document";
import { generateSignatureCode } from "./codes";
import { maskEmail, verifySignatureChain } from "./hash";
import {
  SIGNATURE_METHODS,
  signatureCanSign,
  signatureCanTransition,
  signatureEventLabel,
  signatureIsExpired,
  signatureMethodLabel,
  signatureStatusLabel,
  type SignatureMethodValue,
  type SignatureStatusValue,
} from "./rules";
import { SignatureActionError } from "./portal";

/**
 * Servicio del panel para el portal de firma (issue #79): crear la solicitud
 * desde la ficha del presupuesto, listarla con su cadena de auditoría, cancelar
 * (revocar) y reenviar el correo. Toda escritura queda en `AuditLog` con el
 * actor real de la sesión; la cadena `SignatureEvent` queda append-only.
 */

const MAX_TITLE = 160;
const MAX_NAME = 120;
const MAX_PHONE = 40;
const MAX_MESSAGE = 600;
const MAX_CANCEL_REASON = 300;
const DEFAULT_EXPIRES_DAYS = 15;
const MAX_EXPIRES_DAYS = 90;

const adminInclude = {
  organization: { select: { name: true, slug: true } },
  attachment: { select: { name: true } },
  budget: { select: { title: true } },
  events: {
    orderBy: { occurredAt: "asc" },
    take: 200,
    select: {
      id: true,
      requestId: true,
      eventType: true,
      status: true,
      occurredAt: true,
      actorType: true,
      actorId: true,
      actorName: true,
      ipHash: true,
      userAgentHash: true,
      metadataJson: true,
      previousEventHash: true,
      eventHash: true,
    },
  },
  evidence: {
    orderBy: { createdAt: "asc" },
    select: { type: true, status: true, providerReference: true, capturedAt: true },
  },
} as const;

type AdminSignatureRow = Prisma.SignatureRequestGetPayload<{ include: typeof adminInclude }>;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

function adminEventDetail(row: { eventType: string; metadataJson: unknown; actorName: string | null }): string | null {
  if (row.eventType === "SIGNATURE_RECEIVED") {
    const metadata = (row.metadataJson ?? {}) as Record<string, unknown>;
    const parts = [
      typeof metadata.firmante === "string" ? metadata.firmante : row.actorName,
      typeof metadata.metodo === "string" ? signatureMethodLabel(metadata.metodo) : null,
      typeof metadata.proveedor === "string" ? `proveedor ${metadata.proveedor}` : null,
    ];
    return parts.filter((part): part is string => Boolean(part)).join(" · ") || null;
  }
  const metadata = (row.metadataJson ?? null) as Record<string, unknown> | null;
  if (!metadata || typeof metadata !== "object") return null;
  const text = (key: string, max = 300) => {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
  };
  if (row.eventType === "EMAIL_SENT" || row.eventType === "EMAIL_FAILED" || row.eventType === "COMPLETION_EMAIL_SENT") {
    const to = text("to");
    const reason = text("motivo");
    const reminder = text("tipo") === "recordatorio";
    const days = metadata?.diasRestantes;
    const marker = reminder
      ? typeof days === "number"
        ? `Recordatorio · vence en ${days} día${days === 1 ? "" : "s"}`
        : "Recordatorio de vencimiento"
      : metadata?.reenvio === true
        ? "Reenvío"
        : null;
    return [marker, to ? `A: ${to}` : null, reason].filter((part): part is string => Boolean(part)).join(" · ") || null;
  }
  if (row.eventType === "REJECTED" || row.eventType === "CANCELLED") return text("motivo");
  if (row.eventType === "OTP_SENT") {
    const to = text("destino");
    return to ? `A: ${maskEmail(to)}` : null;
  }
  return null;
}

function adminEventActor(row: { actorType: string; actorName: string | null }): string | null {
  if (row.actorType === "CLIENT") return row.actorName?.trim() || "Cliente (portal)";
  if (row.actorType === "ADMIN") return row.actorName?.trim() || "Equipo";
  return null;
}

/** Vista del panel de una solicitud: estado real, cadena y último correo. */
export function adminSignatureView(row: AdminSignatureRow, mail?: { status: string; error: string | null; to: string; at: Date } | null): AdminSignatureRequestRow {
  const status = row.status as SignatureStatusValue;
  const stale = signatureIsExpired(status, row.expiresAt, new Date());
  const effective = stale ? ("EXPIRED" as SignatureStatusValue) : status;
  return {
    id: row.id,
    code: row.publicCode,
    title: row.title,
    status: effective,
    statusLabel: signatureStatusLabel(effective),
    method: row.method as SignatureMethodValue,
    methodLabel: signatureMethodLabel(row.method),
    otpRequired: row.otpRequired,
    otpVerified: Boolean(row.otpVerifiedAt),
    recipient: { name: row.recipientName, email: row.recipientEmail, phone: row.recipientPhone },
    senderName: row.senderName,
    document: row.attachment ? { kind: "attachment", name: row.attachment.name } : { kind: "budget", name: row.budget.title },
    /** Presupuesto de origen (issue #81): el listado global lo dibuja siempre. */
    budgetTitle: row.budget.title,
    documentHash: row.documentHash,
    signedDocumentHash: row.signedDocumentHash,
    signatureIdentifier: row.signatureIdentifier,
    signatureProvider: row.signatureProvider,
    expiresAt: row.expiresAt.toISOString(),
    sentAt: iso(row.sentAt),
    viewedAt: iso(row.viewedAt),
    signedAt: iso(row.signedAt),
    validatedAt: iso(row.validatedAt),
    rejectedAt: iso(row.rejectedAt),
    rejectionReason: row.rejectionReason,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    portalUrl: signaturePortalUrl(row.publicCode),
    active: signatureCanSign(effective) && !stale,
    chainValid: verifySignatureChain(row.events).valid,
    events: row.events.map((event) => ({
      id: event.id,
      type: event.eventType,
      label: signatureEventLabel(event.eventType),
      status: event.status,
      at: event.occurredAt.toISOString(),
      actor: adminEventActor(event),
      actorType: event.actorType,
      detail: adminEventDetail(event),
      hash: event.eventHash,
      previousHash: event.previousEventHash,
    })),
    evidence: row.evidence.map((item) => ({
      type: item.type,
      status: item.status,
      reference: item.providerReference,
      capturedAt: iso(item.capturedAt),
    })),
    mail: mail ? { status: mail.status, error: mail.error, to: mail.to, at: mail.at.toISOString() } : null,
  };
}

async function lastMailForRequest(requestId: string): Promise<{ status: string; error: string | null; to: string; at: Date } | null> {
  const mail = await db.mailLog.findFirst({
    where: { entity: "SignatureRequest", entityId: requestId, category: "signature" },
    orderBy: { sentAt: "desc" },
    select: { status: true, error: true, to: true, sentAt: true },
  });
  return mail ? { status: mail.status, error: mail.error, to: mail.to, at: mail.sentAt } : null;
}

async function loadAdminRow(organizationId: string, id: string): Promise<AdminSignatureRow | null> {
  return db.signatureRequest.findFirst({ where: { id, organizationId }, include: adminInclude });
}

/** Solicitud de la empresa por id (para el diálogo del panel). */
export async function getSignatureRequest(context: AdminContext, id: string): Promise<AdminSignatureRequestRow | null> {
  const row = await loadAdminRow(context.organizationId, id);
  if (!row) return null;
  return adminSignatureView(row, await lastMailForRequest(row.id));
}

/**
 * Vence las solicitudes activas con plazo cumplido (misma transición perezosa
 * del portal) y devuelve las filas re-leídas cuando hubo cambios, para que el
 * estado que ve el panel sea el real.
 */
async function expireStaleSignatureRequests(
  rows: AdminSignatureRow[],
  where: { organizationId: string; budgetId?: string },
): Promise<AdminSignatureRow[]> {
  const { expireSignatureRequest } = await import("./portal");
  let expiredAny = false;
  for (const row of rows) {
    if (signatureIsExpired(row.status as SignatureStatusValue, row.expiresAt, new Date())) {
      await expireSignatureRequest(row.id);
      expiredAny = true;
    }
  }
  if (!expiredAny) return rows;
  return db.signatureRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: rows.length,
    include: adminInclude,
  });
}

/** Último correo de cada solicitud (una sola consulta del historial de correo). */
async function attachLastMail(rows: AdminSignatureRow[]): Promise<AdminSignatureRequestRow[]> {
  const mails = await db.mailLog.findMany({
    where: { entity: "SignatureRequest", entityId: { in: rows.map((row) => row.id) }, category: "signature" },
    orderBy: { sentAt: "desc" },
    select: { entityId: true, status: true, error: true, to: true, sentAt: true },
  });
  const lastMail = new Map<string, { status: string; error: string | null; to: string; at: Date }>();
  for (const mail of mails) {
    if (mail.entityId && !lastMail.has(mail.entityId)) {
      lastMail.set(mail.entityId, { status: mail.status, error: mail.error, to: mail.to, at: mail.sentAt });
    }
  }
  return rows.map((row) => adminSignatureView(row, lastMail.get(row.id) ?? null));
}

/**
 * Lista las solicitudes de un presupuesto con su cadena completa. Antes de
 * leer, vence las activas con plazo cumplido (misma transición de la lazily
 * expiry del portal) para que el estado que ve el panel sea el real.
 */
export async function listSignatureRequests(context: AdminContext, budgetId: string): Promise<AdminSignatureRequestRow[]> {
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId: context.organizationId },
    select: { id: true },
  });
  if (!budget) return [];

  const where = { organizationId: context.organizationId, budgetId: budget.id };
  const rows = await db.signatureRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: adminInclude,
  });
  return attachLastMail(await expireStaleSignatureRequests(rows, where));
}

/**
 * Listado global de la empresa (sección «Firmas», issue #81): las últimas 200
 * solicitudes con su estado real, presupuesto de origen y último correo. Los
 * filtros (estado, búsqueda) los resuelve la UI sobre esta lista.
 */
export async function listOrganizationSignatureRequests(context: AdminContext): Promise<AdminSignatureRequestRow[]> {
  const where = { organizationId: context.organizationId };
  const rows = await db.signatureRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: adminInclude,
  });
  return attachLastMail(await expireStaleSignatureRequests(rows, where));
}

export type CreateSignatureRequestInput = {
  budgetId: string;
  attachmentId?: string | null;
  title?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  method: string;
  expiresInDays?: number;
  otpRequired?: boolean;
  message?: string | null;
};

export type CreateSignatureRequestResult = {
  request: AdminSignatureRequestRow;
  mail: { status: "sent" | "failed" | "skipped"; error: string | null; to: string | null };
};

/**
 * Crea la solicitud de firma en la ficha del presupuesto (issue #79). El
 * documento es el presupuesto imprimible (huella canónica) o un adjunto PDF
 * existente (huella de los bytes); el código se genera acá y el correo sale si
 * hay destinatario con correo válido. Todo queda auditado y con su evento
 * `REQUEST_CREATED` como primer eslabón de la cadena.
 */
export async function createSignatureRequest(
  context: AdminContext,
  input: CreateSignatureRequestInput,
): Promise<CreateSignatureRequestResult> {
  const budgetId = String(input.budgetId ?? "").trim();
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId: context.organizationId },
    select: signatureBudgetSelect,
  });
  if (!budget) throw new SignatureActionError(404, "No encontramos ese presupuesto.");

  const recipientName = String(input.recipientName ?? "").replace(/\s+/g, " ").trim();
  if (recipientName.length < 2) throw new SignatureActionError(400, "Ingresá el nombre de quien va a firmar.");
  if (recipientName.length > MAX_NAME) throw new SignatureActionError(400, `El nombre no puede superar los ${MAX_NAME} caracteres.`);

  const rawEmail = String(input.recipientEmail ?? "").trim();
  const recipientEmail = rawEmail ? normalizeEmail(rawEmail) : "";
  if (recipientEmail && !emailValid(recipientEmail)) throw new SignatureActionError(400, "El correo del destinatario no es válido.");

  const rawPhone = String(input.recipientPhone ?? "").trim();
  if (rawPhone && !phoneValid(rawPhone)) throw new SignatureActionError(400, "El teléfono del destinatario no es válido.");
  const recipientPhone = rawPhone ? normalizePhone(rawPhone) : "";

  const method = String(input.method ?? "").trim().toUpperCase();
  if (!SIGNATURE_METHODS.includes(method as SignatureMethodValue)) throw new SignatureActionError(400, "Elegí el método de firma (dibujada o tipográfica).");

  const otpRequired = input.otpRequired === true;
  if (otpRequired && !recipientEmail) {
    throw new SignatureActionError(400, "Para pedir verificación por correo, cargá el correo del destinatario.");
  }

  const days = Math.min(Math.max(Math.round(Number(input.expiresInDays) || DEFAULT_EXPIRES_DAYS), 1), MAX_EXPIRES_DAYS);
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  const title = (String(input.title ?? "").trim() || budget.title).slice(0, MAX_TITLE);
  const message = String(input.message ?? "").trim().slice(0, MAX_MESSAGE);

  let attachment: { id: string; name: string; data: Uint8Array } | null = null;
  if (input.attachmentId) {
    const found = await db.budgetAttachment.findFirst({
      where: { id: String(input.attachmentId), organizationId: context.organizationId, budgetId: budget.id },
      select: { id: true, name: true, data: true },
    });
    if (!found) throw new SignatureActionError(404, "No encontramos ese adjunto en el presupuesto.");
    attachment = { id: found.id, name: found.name, data: new Uint8Array(found.data) };
  }

  const code = generateSignatureCode();
  const requestId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budget.id} FOR UPDATE`;
    const currentBudget = await tx.budget.findFirst({ where: { id: budget.id, organizationId: context.organizationId }, select: signatureBudgetSelect });
    if (!currentBudget) throw new SignatureActionError(404, "No encontramos ese presupuesto.");
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { name: true } });
    const budgetDocument = signatureDocument({ source: "live", version: SNAPSHOT_DOCUMENT_VERSION, budget: currentBudget, title, organizationName: organization.name });
    const documentSnapshot = budgetDocumentPayload(budgetDocument);
    // Verifica contrato público antes de guardarlo; no costos ni campos privados.
    signatureDocument({ source: "snapshot", payload: documentSnapshot });
    const commercialHash = budgetDocumentHash(documentSnapshot);
    const documentHash = attachment ? attachmentDocumentHash(attachment.data) : commercialHash;
    await tx.signatureRequest.create({
      data: {
        id: requestId,
        organizationId: context.organizationId,
        budgetId: budget.id,
        attachmentId: attachment?.id ?? null,
        publicCode: code,
        title,
        senderId: context.user.id,
        senderName: context.user.name,
        senderEmail: context.user.email,
        recipientName,
        recipientEmail: recipientEmail || null,
        recipientPhone: recipientPhone || null,
        status: "SENT",
        method: method as SignatureMethodValue,
        otpRequired,
        expiresAt,
        sentAt: null,
        documentHash,
        documentHashCapturedAt: new Date(),
      },
    });
    const evidenceRows: Array<{ type: "SIGNATURE" | "OTP" | "PHOTO" | "TIMESTAMP" | "SEAL"; status: "PENDING" | "OPTIONAL" }> = [
      { type: "SIGNATURE", status: "PENDING" },
      { type: "OTP", status: otpRequired ? "PENDING" : "OPTIONAL" },
      // La foto/evidencia adicional queda fuera de la Fase 1: se registra como opcional.
      { type: "PHOTO", status: "OPTIONAL" },
      { type: "TIMESTAMP", status: "PENDING" },
      { type: "SEAL", status: "PENDING" },
    ];
    for (const evidence of evidenceRows) {
      await tx.signatureEvidence.create({
        data: {
          id: randomUUID(),
          organizationId: context.organizationId,
          requestId,
          type: evidence.type,
          status: evidence.status,
        },
      });
    }
    await appendSignatureEvent(
      {
        requestId,
        organizationId: context.organizationId,
        eventType: "REQUEST_CREATED",
        status: "SENT",
        actor: { type: "ADMIN", id: context.user.id, name: context.user.name },
        metadata: {
          documento: attachment ? attachment.name : `Presupuesto «${budget.title}»`,
          documentoHash: documentHash,
          commercialHash,
          documentVersion: SNAPSHOT_DOCUMENT_VERSION,
          documentSnapshot,
          documentSnapshotHash: commercialHash,
          metodo: method,
          destinatario: recipientName,
          vence: expiresAt.toISOString(),
        },
      },
      tx,
    );
  });

  // Correo de solicitud (si hay destinatario). El evento refleja el resultado real.
  let mail: { status: "sent" | "failed" | "skipped"; error: string | null; to: string | null } = {
    status: "skipped",
    error: null,
    to: null,
  };
  if (recipientEmail) {
    const content = buildSignatureRequestMail({
      organizationName: context.organization.name,
      title,
      recipientName,
      senderName: context.user.name,
      code,
      portalUrl: signaturePortalUrl(code),
      expiresAt,
      methodLabel: signatureMethodLabel(method),
      message,
    });
    const result = await sendMail({
      to: recipientEmail,
      subject: content.subject,
      category: "signature",
      html: content.html,
      text: content.text,
      organizationId: context.organizationId,
      entity: "SignatureRequest",
      entityId: requestId,
      actor: context.user,
    });
    mail = { status: result.status, error: result.error ?? null, to: recipientEmail };
    if (result.status === "sent") {
      await db.signatureRequest.update({ where: { id: requestId }, data: { sentAt: new Date() } });
    }
    await appendSignatureEvent({
      requestId,
      organizationId: context.organizationId,
      eventType: result.status === "sent" ? "EMAIL_SENT" : "EMAIL_FAILED",
      status: "SENT",
      actor: { type: "SYSTEM" },
      metadata: { to: recipientEmail, motivo: result.status === "sent" ? null : result.error ?? "Sin proveedor de correo configurado" },
    });
  }

  await recordAudit({
    context,
    action: "create",
    entity: "SignatureRequest",
    entityId: requestId,
    summary: `Envió a firma «${title}» a «${recipientName}» (código ${code})`,
    detail: {
      fields: {
        presupuesto: budget.title,
        documento: attachment ? attachment.name : "Presupuesto imprimible",
        metodo: method,
        otp: otpRequired,
        vence: expiresAt,
        correo: recipientEmail || null,
      },
    },
  });

  const row = await loadAdminRow(context.organizationId, requestId);
  if (!row) throw new SignatureActionError(500, "No pudimos leer la solicitud recién creada.");
  return { request: adminSignatureView(row, await lastMailForRequest(requestId)), mail };
}

/** Cancela (revoca) una solicitud activa: bloquea la firma y deja su evento. */
export async function cancelSignatureRequest(
  context: AdminContext,
  id: string,
  reason: string | null | undefined,
): Promise<AdminSignatureRequestRow> {
  const cleanReason = String(reason ?? "").trim().slice(0, MAX_CANCEL_REASON);
  const row = await loadAdminRow(context.organizationId, id);
  if (!row) throw new SignatureActionError(404, "No encontramos esa solicitud de firma.");
  const status = row.status as SignatureStatusValue;
  if (signatureIsExpired(status, row.expiresAt, new Date())) {
    const { expireSignatureRequest } = await import("./portal");
    await expireSignatureRequest(row.id);
    throw new SignatureActionError(409, "La solicitud ya venció.");
  }
  if (!signatureCanSign(status)) {
    throw new SignatureActionError(
      409,
      status === "SIGNED" || status === "VALIDATED"
        ? "La solicitud ya está firmada: no se puede cancelar."
        : "La solicitud ya no está activa.",
    );
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    await lockSignatureRequest(tx, row.id);
    const fresh = await tx.signatureRequest.findUnique({ where: { id: row.id }, select: { status: true, expiresAt: true } });
    if (!fresh || !signatureCanSign(fresh.status as SignatureStatusValue)) {
      throw new SignatureActionError(409, "La solicitud ya no está activa.");
    }
    if (!signatureCanTransition(fresh.status as SignatureStatusValue, "CANCELLED")) {
      throw new SignatureActionError(409, "El estado actual no permite cancelar la solicitud.");
    }
    await tx.signatureRequest.update({
      where: { id: row.id },
      data: { status: "CANCELLED", cancelledAt: now, cancelledByName: context.user.name, cancelReason: cleanReason || null },
    });
    await appendSignatureEvent(
      {
        requestId: row.id,
        organizationId: context.organizationId,
        eventType: "CANCELLED",
        status: "CANCELLED",
        actor: { type: "ADMIN", id: context.user.id, name: context.user.name },
        metadata: cleanReason ? { motivo: cleanReason } : null,
        occurredAt: now,
      },
      tx,
    );
  });

  await recordAudit({
    context,
    action: "status",
    entity: "SignatureRequest",
    entityId: row.id,
    summary: `Canceló la solicitud de firma «${row.title}» (código ${row.publicCode})`,
    detail: { changes: { status: { from: status, to: "CANCELLED" } }, fields: cleanReason ? { motivo: cleanReason } : undefined },
  });

  const fresh = await loadAdminRow(context.organizationId, row.id);
  if (!fresh) throw new SignatureActionError(500, "No pudimos leer la solicitud cancelada.");
  return adminSignatureView(fresh, await lastMailForRequest(row.id));
}

/** Reenvía el correo de la solicitud (mismo link y código) si sigue activa. */
export async function resendSignatureRequest(
  context: AdminContext,
  id: string,
): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null; to: string | null }> {
  const row = await loadAdminRow(context.organizationId, id);
  if (!row) throw new SignatureActionError(404, "No encontramos esa solicitud de firma.");
  const status = row.status as SignatureStatusValue;
  if (signatureIsExpired(status, row.expiresAt, new Date())) {
    const { expireSignatureRequest } = await import("./portal");
    await expireSignatureRequest(row.id);
    throw new SignatureActionError(409, "La solicitud ya venció: creá una nueva para volver a enviarla.");
  }
  if (!signatureCanSign(status)) throw new SignatureActionError(409, "La solicitud ya no está activa.");
  if (!row.recipientEmail) throw new SignatureActionError(409, "La solicitud no tiene correo cargado: compartí el link a mano.");

  const content = buildSignatureRequestMail({
    organizationName: row.organization.name,
    title: row.title,
    recipientName: row.recipientName,
    senderName: context.user.name,
    code: row.publicCode,
    portalUrl: signaturePortalUrl(row.publicCode),
    expiresAt: row.expiresAt,
    methodLabel: signatureMethodLabel(row.method),
  });
  const result = await sendMail({
    to: row.recipientEmail,
    subject: content.subject,
    category: "signature",
    html: content.html,
    text: content.text,
    organizationId: context.organizationId,
    entity: "SignatureRequest",
    entityId: row.id,
    actor: context.user,
  });
  if (result.status === "sent") {
    await db.signatureRequest.update({ where: { id: row.id }, data: { sentAt: new Date() } });
  }
  await appendSignatureEvent({
    requestId: row.id,
    organizationId: context.organizationId,
    eventType: result.status === "sent" ? "EMAIL_SENT" : "EMAIL_FAILED",
    status: row.status,
    actor: { type: "SYSTEM" },
    metadata: { to: row.recipientEmail, motivo: result.status === "sent" ? null : result.error ?? "Sin proveedor de correo configurado", reenvio: true },
  });
  await recordAudit({
    context,
    action: "send",
    entity: "SignatureRequest",
    entityId: row.id,
    summary: `Reenvió a firma «${row.title}» a «${row.recipientName}» (código ${row.publicCode})`,
    detail: { fields: { to: row.recipientEmail, status: result.status, ...(result.error ? { error: result.error } : {}) } },
  });
  return { status: result.status, error: result.error ?? null, to: row.recipientEmail };
}
