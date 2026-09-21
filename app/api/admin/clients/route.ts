import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() { if (!(await requireAdmin())) return jsonError("Unauthorized", 401); return Response.json({ clients: await db.client.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { events: true, budgets: true } } } }) }); }
export async function POST(request: Request) { if (!(await requireAdmin())) return jsonError("Unauthorized", 401); const body = await readJson(request) as Record<string, unknown>; if (typeof body.name !== "string" || body.name.trim().length < 2) return jsonError("Name is required.", 400); const client = await db.client.create({ data: { id: randomUUID(), name: body.name.trim(), company: typeof body.company === "string" ? body.company.trim() : undefined, type: body.type === "RESELLER" ? "RESELLER" : "FINAL", email: typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined, phone: typeof body.phone === "string" ? body.phone.trim() : undefined, ruc: typeof body.ruc === "string" ? body.ruc.trim() : undefined } }); return Response.json({ client }, { status: 201 }); }
