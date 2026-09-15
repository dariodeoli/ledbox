import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const honeypot = z.string().max(0).optional().or(z.literal(""));

export const authSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
  honeypot,
  website: honeypot,
});

export const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(320), honeypot, website: honeypot });

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(8).max(128),
  honeypot,
  website: honeypot,
});

const productSchema = z.object({
  productId: z.string().trim().min(1).max(120).optional(),
  productSlug: z.string().trim().min(1).max(120).optional(),
  productName: z.string().trim().max(240).optional(),
  quantity: z.coerce.number().int().min(1).max(100),
  duration: z.coerce.number().int().min(1).max(365).optional(),
  unitPrice: z.coerce.number().int().min(0).max(100_000_000).optional(),
  subtotal: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  notes: optionalText(500),
});

export const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().max(320),
  company: optionalText(160),
  ruc: optionalText(40),
  reason: optionalText(240),
  eventDate: optionalText(40),
  location: optionalText(240),
  message: optionalText(4000),
  source: optionalText(80),
  products: z.array(productSchema).max(50).optional(),
  honeypot,
  website: honeypot,
});

export const quoteSchema = z.object({
  leadId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  phone: optionalText(40),
  email: z.string().trim().email().max(320),
  company: optionalText(160),
  referenceTotal: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  currency: z.string().trim().min(3).max(8).default("PYG"),
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  eventDate: optionalText(40),
  location: optionalText(240),
  source: optionalText(80),
  details: optionalText(4000),
  items: z.array(productSchema).max(50).optional(),
  honeypot,
  website: honeypot,
});

export function validationError(error: z.ZodError): Response {
  return Response.json({ error: "Invalid request.", fields: error.flatten().fieldErrors }, { status: 400 });
}

export function isHoneypotTriggered(...values: unknown[]): boolean {
  return values.some((value) => typeof value === "string" && value.trim().length > 0);
}
