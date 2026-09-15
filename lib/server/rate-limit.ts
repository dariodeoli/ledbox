import { randomUUID } from "node:crypto";
import { db } from "./db";

const WINDOW_MS = 15 * 60 * 1000;

export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function rateLimit(key: string, limit: number): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = new Date();
  const existing = await db.rateLimitBucket.findUnique({ where: { key } });
  if (!existing || now.getTime() - existing.windowStart.getTime() >= WINDOW_MS) {
    await db.rateLimitBucket.upsert({
      where: { key },
      create: { id: randomUUID(), key, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
    return { allowed: true, retryAfter: WINDOW_MS / 1000 };
  }
  const retryAfter = Math.ceil((existing.windowStart.getTime() + WINDOW_MS - now.getTime()) / 1000);
  if (existing.count >= limit) return { allowed: false, retryAfter };
  await db.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
  return { allowed: true, retryAfter };
}

export function rateLimitResponse(retryAfter: number): Response {
  return Response.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}
