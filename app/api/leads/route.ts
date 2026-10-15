import { randomUUID } from "node:crypto";
import { BillingUnit, LeadStatus, type Prisma } from "@prisma/client";
import { registroConsentimiento } from "owncoding-ui/utils";
import { rucDocument } from "@/lib/field-rules";
import { resolveClientFromLead } from "@/lib/server/lead-client";
import { APP_VERSION } from "@/lib/version";
import { db } from "@/lib/server/db";
import { requireAdminContext, resolveDefaultOrganizationId } from "@/lib/server/tenancy";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, leadSchema, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { live } from "@/lib/server/trash-filter";
import { assertLive, trashErrorResponse } from "@/lib/server/trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTERNAL_NOTES = 2000;

/**
 * Contrato de lectura del panel: el lead con todos sus pedidos e ítems y los
 * presupuestos que nacieron de él (Lead → Presupuesto).
 */
const LEAD_INCLUDE = {
  quoteRequests: { orderBy: { createdAt: "desc" }, include: { items: true, budget: { select: { id: true } }, priceRequests: { orderBy: { createdAt: "desc" } } } },
  budgets: { where: live, select: { id: true, title: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.LeadInclude;

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
  // Constancia de consentimiento (Ley 7593/2025, brecha B2): el aviso lo dio el
  // formulario del sitio y el servidor sella el momento. `registroConsentimiento`
  // de la librería normaliza la constancia (canal, versión y fecha) y acá se
  // persisten sus campos; la UI del consentimiento completo llega en la Tanda 2.
  const consentimiento = registroConsentimiento({
    finalidad: "consulta",
    aceptado: true,
    version: APP_VERSION,
    canal: "sitio-web",
  });
  const lead = await db.lead.create({
    data: {
      id: randomUUID(),
      organizationId: organizationId ?? undefined,
      name: leadData.name,
      phone: leadData.phone,
      email: leadData.email.trim().toLowerCase(),
      company: leadData.company || undefined,
      ruc: rucDocument(leadData.ruc) || undefined,
      reason: leadData.reason || undefined,
      eventDate: eventDate || undefined,
      location: leadData.location || undefined,
      message: leadData.message || undefined,
      source: leadData.source || "website",
      consentAt: new Date(consentimiento.fecha),
      consentChannel: consentimiento.canal,
      consentVersion: consentimiento.version,
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

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > 200) return jsonError("La búsqueda admite hasta 200 caracteres.", 400);
  const fields = ["name", "company", "email", "phone", "ruc", "reason", "location", "message"] as const;
  const search = query ? { OR: fields.map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {};
  const fetched = await db.lead.findMany({
    where: { organizationId: auth.context.organizationId, ...search },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 101,
    include: LEAD_INCLUDE,
  });
  return Response.json({ leads: fetched.slice(0, 100), truncated: fetched.length > 100 });
}

/**
 * Pipeline comercial: cambia el estado, guarda las notas internas y convierte
 * el lead en cliente. Exige `clients.write` (VIEWER no muta) y siempre acota la
 * búsqueda a la empresa activa: un id de otra empresa responde 404.
 */
export async function PATCH(request: Request) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const raw = await readJson(request);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jsonError("Datos del lead inválidos.", 400);
  const body = raw as Record<string, unknown>;

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return jsonError("Elegí el lead que querés actualizar.", 400);

  const lead = await db.lead.findFirst({ where: { id, organizationId: auth.context.organizationId } });
  if (!lead) return jsonError("No encontramos ese lead en la empresa activa.", 404);

  // Solo se revalida lo que cambia; el resto del lead queda intacto (legacy).
  const data: { status?: LeadStatus; internalNotes?: string | null } = {};
  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (!Object.values(LeadStatus).includes(status as LeadStatus)) return jsonError("Estado del lead inválido.", 400);
    data.status = status as LeadStatus;
  }
  if ("internalNotes" in body) {
    if (body.internalNotes !== null && typeof body.internalNotes !== "string") return jsonError("Las notas internas deben ser texto.", 400);
    const notes = typeof body.internalNotes === "string" ? body.internalNotes.trim() : "";
    if (notes.length > MAX_INTERNAL_NOTES) return jsonError("Las notas internas superan el largo permitido.", 400);
    data.internalNotes = notes || null;
  }

  const convert = body.convertToClient === true;
  if (!convert && Object.keys(data).length === 0) return jsonError("No hay cambios para guardar.", 400);

  let result;
  try {
    result = await db.$transaction(async (tx) => {
    // Papelera: un lead eliminado entre la lectura y la escritura da 404, no se edita.
    await assertLive("Lead", lead.id, auth.context.organizationId, tx);
    let client: { id: string; name: string; company: string | null } | null = null;
    let clientCreated = false;

    if (convert) {
      // Sin duplicar: si ya hay un cliente de la empresa con el mismo email o
      // teléfono (comparado por su clave nacional), se reutiliza y solo se
      // marca WON.
      const resolved = await resolveClientFromLead(tx, auth.context.organizationId, lead);
      if (resolved) {
        client = resolved.client;
        clientCreated = resolved.created;
      }
      // El lock del resolver puede esperar a otra conversión: revalidar que
      // el lead siga vigente antes de confirmar también la creación del cliente.
      await assertLive("Lead", lead.id, auth.context.organizationId, tx);
      data.status = LeadStatus.WON;
    }

    const updated = await tx.lead.update({ where: { id: lead.id }, data, include: LEAD_INCLUDE });
    return { lead: updated, client, clientCreated };
    });
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }

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
