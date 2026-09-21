import { randomUUID } from "node:crypto";
import { BillingUnit, LeadStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { requireAdminContext, resolveDefaultOrganizationId } from "@/lib/server/tenancy";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, leadSchema, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTERNAL_NOTES = 2000;

/** Contrato de lectura del panel: el lead con todos sus pedidos e ítems. */
const LEAD_INCLUDE = { quoteRequests: { include: { items: true } } } satisfies Prisma.LeadInclude;

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Clave de teléfono comparable: solo dígitos, sin prefijo de país ni 0 inicial. */
function phoneKey(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "";
  if (digits.startsWith("595")) return digits.slice(3);
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

export async function POST(request: Request) {
  const limited = await rateLimit(`leads:create:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const body = await readJson(request);
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);
  const eventDate = parseDate(parsed.data.eventDate);
  if (parsed.data.eventDate && eventDate === null) return jsonError("Invalid event date.", 400);

  // La captura pública entra a la empresa por defecto (DEFAULT_ORGANIZATION_SLUG,
  // fallback primera organización). La respuesta no cambia.
  const organizationId = await resolveDefaultOrganizationId();

  const { honeypot: _honeypot, website: _website, products, eventDate: _rawEventDate, ...leadData } = parsed.data;
  const lead = await db.lead.create({
    data: {
      id: randomUUID(),
      organizationId: organizationId ?? undefined,
      name: leadData.name,
      phone: leadData.phone,
      email: leadData.email.trim().toLowerCase(),
      company: leadData.company || undefined,
      ruc: leadData.ruc || undefined,
      reason: leadData.reason || undefined,
      eventDate: eventDate || undefined,
      location: leadData.location || undefined,
      message: leadData.message || undefined,
      source: leadData.source || "website",
      consentAt: new Date(),
    },
  });

  if (products?.length) {
    await db.quoteRequest.create({
      data: {
        id: randomUUID(),
        leadId: lead.id,
        organizationId: organizationId ?? undefined,
        source: leadData.source || "website",
        eventDate: eventDate || undefined,
        location: leadData.location || undefined,
        items: {
          create: products.map((item) => ({
            id: randomUUID(),
            productSlug: item.productSlug || item.productId || "custom-request",
            productName: item.productName || item.productSlug || item.productId || "Requested item",
            quantity: item.quantity,
            duration: item.duration,
            billingUnit: item.duration ? BillingUnit.DAILY : BillingUnit.EVENT,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            notes: item.notes || undefined,
          })),
        },
      },
    });
  }

  return Response.json({ lead: { id: lead.id, createdAt: lead.createdAt } }, { status: 201 });
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const leads = await db.lead.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: LEAD_INCLUDE,
  });
  return Response.json({ leads });
}

/**
 * Pipeline comercial: cambia el estado, guarda las notas internas y convierte
 * el lead en cliente. Exige `clients.write` (VIEWER no muta) y siempre acota la
 * búsqueda a la empresa activa: un id de otra empresa responde 404.
 */
export async function PATCH(request: Request) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const body = (await readJson(request)) as Record<string, unknown>;

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return jsonError("Lead id is required.", 400);

  const lead = await db.lead.findFirst({ where: { id, organizationId: auth.context.organizationId } });
  if (!lead) return jsonError("Lead not found.", 404);

  // Solo se revalida lo que cambia; el resto del lead queda intacto (legacy).
  const data: { status?: LeadStatus; internalNotes?: string | null } = {};
  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (!Object.values(LeadStatus).includes(status as LeadStatus)) return jsonError("Invalid lead status.", 400);
    data.status = status as LeadStatus;
  }
  if ("internalNotes" in body) {
    if (body.internalNotes !== null && typeof body.internalNotes !== "string") return jsonError("Invalid internal notes.", 400);
    const notes = typeof body.internalNotes === "string" ? body.internalNotes.trim() : "";
    if (notes.length > MAX_INTERNAL_NOTES) return jsonError("Internal notes are too long.", 400);
    data.internalNotes = notes || null;
  }

  const convert = body.convertToClient === true;
  if (!convert && Object.keys(data).length === 0) return jsonError("Nothing to update.", 400);

  const result = await db.$transaction(async (tx) => {
    let client: { id: string; name: string; company: string | null } | null = null;
    let clientCreated = false;

    if (convert) {
      // Sin duplicar: si ya hay un cliente de la empresa con el mismo email o
      // teléfono (comparado por dígitos), se reutiliza y solo se marca WON.
      const email = lead.email.trim().toLowerCase();
      const phone = phoneKey(lead.phone);
      const candidates = await tx.client.findMany({
        where: { organizationId: auth.context.organizationId, OR: [{ email: { not: null } }, { phone: { not: null } }] },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: { id: true, name: true, company: true, email: true, phone: true },
      });
      const existing = candidates.find(
        (candidate) =>
          (email.length > 0 && candidate.email?.trim().toLowerCase() === email) ||
          (phone.length > 0 && phoneKey(candidate.phone) === phone),
      );
      if (existing) {
        client = { id: existing.id, name: existing.name, company: existing.company };
      } else {
        const created = await tx.client.create({
          data: {
            id: randomUUID(),
            organizationId: auth.context.organizationId,
            type: "FINAL",
            name: lead.name,
            company: lead.company || undefined,
            email: lead.email.trim().toLowerCase() || undefined,
            phone: lead.phone || undefined,
            ruc: lead.ruc || undefined,
          },
          select: { id: true, name: true, company: true },
        });
        client = created;
        clientCreated = true;
      }
      data.status = LeadStatus.WON;
    }

    const updated = await tx.lead.update({ where: { id: lead.id }, data, include: LEAD_INCLUDE });
    return { lead: updated, client, clientCreated };
  });

  if (convert) {
    const convertedClient = result.client;
    await recordAudit({
      context: auth.context,
      action: "convert",
      entity: "Lead",
      entityId: lead.id,
      summary: result.clientCreated
        ? `Convirtió el lead «${lead.name}» en el cliente «${convertedClient?.name}»`
        : `Convirtió el lead «${lead.name}» y reutilizó el cliente «${convertedClient?.name}»`,
      detail: { fields: { clientId: convertedClient?.id ?? null, clientCreated: result.clientCreated, status: result.lead.status } },
    });
    if (result.clientCreated && convertedClient) {
      await recordAudit({
        context: auth.context,
        action: "create",
        entity: "Client",
        entityId: convertedClient.id,
        summary: `Creó el cliente «${convertedClient.name}» al convertir el lead`,
        detail: { fields: { name: convertedClient.name, company: convertedClient.company, fromLeadId: lead.id } },
      });
    }
  } else {
    const changes = auditChanges(
      { status: lead.status, internalNotes: lead.internalNotes },
      { status: result.lead.status, internalNotes: result.lead.internalNotes },
      ["status", "internalNotes"],
    );
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "status" in changes ? "status" : "update",
        entity: "Lead",
        entityId: lead.id,
        summary: "status" in changes
          ? `Cambió el estado del lead «${lead.name}»`
          : `Actualizó las notas internas del lead «${lead.name}»`,
        detail: { changes },
      });
    }
  }

  return Response.json(result);
}
