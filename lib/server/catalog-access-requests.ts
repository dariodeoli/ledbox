import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACCESS_REQUEST_ACK, ACCESS_REQUEST_KINDS, type AccessRequestKind } from "@/lib/catalog-access-mode";
import { normalizePhone, phoneValid } from "@/lib/field-rules";
import { publicConfig } from "@/lib/public-config";
import { db } from "./db";
import { issueCatalogAccessTx } from "./catalog-access";
import { resolveClientFromLead } from "./lead-client";
import { sendMail, type MailActor } from "./mail";
import { buildAccessApprovedMail } from "./mail/catalog";
import { mailBrandFor } from "./mail/org-brand";
import type { AdminContext } from "./tenancy";

/**
 * Solicitudes de acceso al catálogo (modo «Con solicitud»).
 *
 * - La persona pide acceso con nombre, empresa, teléfono, correo y tipo. El endpoint es público:
 *   rate-limit por IP, honeypot y tope de pendientes por empresa. **La respuesta es siempre la
 *   misma** exista o no ya una solicitud con ese correo: no se revela quién ya pidió ni quién es cliente.
 * - La empresa aprueba o rechaza desde el panel. Al aprobar se resuelve (o crea) el cliente de ESA
 *   empresa, se genera su link reutilizando `CatalogAccessToken` (en la misma transacción) y se
 *   le manda por correo con `sendMail`. El token plano solo viaja en esa respuesta y en el correo.
 */

export const ACCESS_PENDING_CAP = 200;

const honeypot = z.string().max(0).optional().or(z.literal(""));
export const accessRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().min(6).max(40).refine((value) => phoneValid(value), "Ingresá un teléfono válido con código de país."),
  email: z.string().trim().email().max(200),
  kind: z.enum(ACCESS_REQUEST_KINDS),
  honeypot,
  website: honeypot,
});
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

/** Registra la solicitud (si corresponde). Devuelve siempre el mismo acuse: nada que delate duplicados. */
export async function submitAccessRequest(organizationId: string, input: AccessRequestInput): Promise<{ ack: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const duplicate = await db.catalogAccessRequest.findFirst({
    where: { organizationId, email, status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true },
  });
  if (duplicate) return { ack: ACCESS_REQUEST_ACK, created: false };
  const pending = await db.catalogAccessRequest.count({ where: { organizationId, status: "PENDING" } });
  if (pending >= ACCESS_PENDING_CAP) return { ack: ACCESS_REQUEST_ACK, created: false };
  await db.catalogAccessRequest.create({
    data: {
      id: randomUUID(),
      organizationId,
      name: input.name,
      company: input.company?.trim() || null,
      phone: normalizePhone(input.phone),
      email,
      kind: input.kind,
    },
  });
  return { ack: ACCESS_REQUEST_ACK, created: true };
}

export type AccessRequestRow = {
  id: string;
  name: string;
  company: string | null;
  phone: string;
  email: string;
  kind: AccessRequestKind;
  status: string;
  rejectionReason: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  createdAt: string;
};

export async function listAccessRequests(organizationId: string): Promise<AccessRequestRow[]> {
  const rows = await db.catalogAccessRequest.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    kind: row.kind === "WHOLESALE" ? "WHOLESALE" : "RETAIL",
    status: row.status,
    rejectionReason: row.rejectionReason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByName: row.decidedByName,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type ApproveResult =
  | {
      ok: true;
      url: string;
      client: { id: string; name: string; company: string | null };
      clientCreated: boolean;
      mail: { status: "sent" | "failed" | "skipped"; error?: string };
    }
  | { ok: false; status: number; error: string };

class Conflict extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function approveAccessRequest(context: AdminContext, requestId: string, actor: MailActor): Promise<ApproveResult> {
  const { organizationId } = context;
  const request = await db.catalogAccessRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!request) return { ok: false, status: 404, error: "La solicitud no existe en esta empresa." };
  if (request.status !== "PENDING") return { ok: false, status: 409, error: "Esta solicitud ya fue respondida." };
  const kind: AccessRequestKind = request.kind === "WHOLESALE" ? "WHOLESALE" : "RETAIL";

  let issued: { token: string; id: string };
  let resolved: { client: { id: string; name: string; company: string | null }; created: boolean };
  try {
    const out = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CatalogAccessRequest" WHERE "id" = ${request.id} FOR UPDATE`;
        const fresh = await tx.catalogAccessRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true } });
        if (fresh.status !== "PENDING") throw new Conflict(409, "Esta solicitud ya fue respondida.");
        const client = await resolveClientFromLead(
          tx,
          organizationId,
          { name: request.name, company: request.company, email: request.email, phone: request.phone, ruc: null },
          { allowCreate: true },
        );
        if (!client) throw new Conflict(403, "No se pudo asociar la solicitud a un cliente.");
        const link = await issueCatalogAccessTx(tx, organizationId, client.client.id, kind);
        await tx.catalogAccessRequest.update({
          where: { id: request.id },
          data: { status: "APPROVED", clientId: client.client.id, decidedAt: new Date(), decidedByName: context.user.name },
        });
        return { issued: link, resolved: client };
      },
      { timeout: 20_000 },
    );
    issued = out.issued;
    resolved = out.resolved;
  } catch (error) {
    if (error instanceof Conflict) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const base = `${publicConfig.storeUrl}/tienda/${context.organization.slug}`;
  const url = kind === "WHOLESALE" ? `${base}/mayorista/${issued.token}` : `${base}/acceso/${issued.token}`;
  const brand = await mailBrandFor(organizationId);
  const content = buildAccessApprovedMail({ organizationName: context.organization.name, name: request.name, url, kind, brand });
  const sent = await sendMail({
    to: request.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    category: "catalog",
    organizationId,
    entity: "CatalogAccessRequest",
    entityId: request.id,
    actor,
  });
  if (sent.status === "failed") console.error("catalog-access: no se pudo enviar el correo del acceso aprobado", { requestId: request.id, error: sent.error });
  return {
    ok: true,
    url,
    client: resolved.client,
    clientCreated: resolved.created,
    mail: { status: sent.status, error: sent.error },
  };
}

export async function rejectAccessRequest(context: AdminContext, requestId: string, reason: string | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const updated = await db.catalogAccessRequest.updateMany({
    where: { id: requestId, organizationId: context.organizationId, status: "PENDING" },
    data: { status: "REJECTED", rejectionReason: reason, decidedAt: new Date(), decidedByName: context.user.name },
  });
  if (updated.count === 1) return { ok: true };
  const exists = await db.catalogAccessRequest.findFirst({ where: { id: requestId, organizationId: context.organizationId }, select: { id: true } });
  return exists ? { ok: false, status: 409, error: "Esta solicitud ya fue respondida." } : { ok: false, status: 404, error: "La solicitud no existe en esta empresa." };
}
