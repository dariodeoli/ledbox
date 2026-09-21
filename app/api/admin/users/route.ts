import { randomUUID } from "node:crypto";
import { requireAdmin, hashPassword } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canManageUsers() { const auth = await requireAdmin(); return auth && ["OWNER", "ADMIN"].includes(auth.user.role) ? auth : null; }

export async function GET() {
  if (!(await canManageUsers())) return jsonError("Forbidden", 403);
  const users = await db.adminUser.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } });
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await canManageUsers();
  if (!auth) return jsonError("Forbidden", 403);
  const body = await readJson(request) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = ["ADMIN", "FINANCE", "OPERATIONS", "VIEWER"].includes(String(body.role)) ? String(body.role) as "ADMIN" | "FINANCE" | "OPERATIONS" | "VIEWER" : "VIEWER";
  if (!email.includes("@") || name.length < 2 || password.length < 12) return jsonError("Name, valid email and password of at least 12 characters are required.", 400);
  if (await db.adminUser.findUnique({ where: { email } })) return jsonError("A user with this email already exists.", 409);
  const user = await db.adminUser.create({ data: { id: randomUUID(), name, email, passwordHash: await hashPassword(password), role } });
  return Response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await canManageUsers();
  if (!auth) return jsonError("Forbidden", 403);
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.id !== "string") return jsonError("User id is required.", 400);
  const data: { active?: boolean; role?: "ADMIN" | "FINANCE" | "OPERATIONS" | "VIEWER" } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (["ADMIN", "FINANCE", "OPERATIONS", "VIEWER"].includes(String(body.role))) data.role = String(body.role) as typeof data.role;
  if (body.id === auth.user.id && data.active === false) return jsonError("You cannot deactivate your current user.", 400);
  const user = await db.adminUser.update({ where: { id: body.id }, data, select: { id: true, name: true, email: true, role: true, active: true } });
  return Response.json({ user });
}
