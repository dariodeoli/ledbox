import { randomUUID } from "node:crypto";
import { BillingUnit } from "@prisma/client";
import { db } from "@/lib/server/db";
import { requireAdminContext, resolveDefaultOrganizationId } from "@/lib/server/tenancy";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, leadSchema, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    include: { quoteRequests: true },
  });
  return Response.json({ leads });
}
