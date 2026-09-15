import { randomUUID } from "node:crypto";
import { BillingUnit } from "@prisma/client";
import { db } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isHoneypotTriggered, quoteSchema, validationError } from "@/lib/server/validation";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request) {
  const limited = await rateLimit(`quotes:create:${getClientIp(request)}`, 10);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const body = await readJson(request);
  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  if (isHoneypotTriggered(parsed.data.honeypot, parsed.data.website)) return jsonError("Invalid request.", 400);
  const eventDate = parseDate(parsed.data.eventDate);
  if (parsed.data.eventDate && eventDate === null) return jsonError("Invalid event date.", 400);
  const items = parsed.data.items?.length ? parsed.data.items : [{ quantity: 1, notes: parsed.data.details || undefined }];
  const quote = await db.quoteRequest.create({
    data: {
      id: randomUUID(),
      leadId: parsed.data.leadId,
      referenceTotal: parsed.data.referenceTotal,
      currency: parsed.data.currency,
      durationDays: parsed.data.durationDays,
      eventDate: eventDate || undefined,
      location: parsed.data.location || undefined,
      source: parsed.data.source || "website",
      items: {
        create: items.map((item) => ({
          id: randomUUID(),
          productSlug: item.productSlug || item.productId || "custom-request",
          productName: item.productName || item.productSlug || item.productId || "Quote request",
          quantity: item.quantity,
          duration: item.duration,
          billingUnit: item.duration ? BillingUnit.DAILY : BillingUnit.EVENT,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
          notes: item.notes || undefined,
        })),
      },
    },
    include: { items: true },
  });
  return Response.json({ quote: { id: quote.id, createdAt: quote.createdAt } }, { status: 201 });
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) return jsonError("Unauthorized", 401);
  const quotes = await db.quoteRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { items: true, lead: true } });
  return Response.json({ quotes });
}
