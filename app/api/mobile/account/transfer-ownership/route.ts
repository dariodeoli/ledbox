import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/auth";
import { isDemoOrganizationSlug } from "@/lib/server/demo-data";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { mobileContext } from "@/lib/server/mobile/session";
import { mobileInput, mobileJSON } from "@/lib/server/mobile/http";

const inputSchema = z.object({ password: z.string().min(1).max(200), targetUserId: z.string().min(1).max(200), confirmation: z.literal("TRANSFER_OWNERSHIP") }).strict();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await mobileContext(request);
  if (!context.ok) return context.response;
  if (context.membership.role !== "OWNER" || isDemoOrganizationSlug(context.membership.organization.slug)) return mobileJSON({ error: "Forbidden", code: "forbidden" }, 403);
  const limited = await rateLimit(`mobile:transfer:${context.auth.user.id}`, 5);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const input = await mobileInput(request, inputSchema);
  if (!input.ok) return input.response;
  if (input.data.targetUserId === context.auth.user.id) return mobileJSON({ error: "Seleccioná otro miembro activo.", code: "invalid_successor" }, 400);
  const user = await db.adminUser.findUnique({ where: { id: context.auth.user.id } });
  if (!user?.active || !(await verifyPassword(input.data.password, user.passwordHash))) return mobileJSON({ error: "Reautenticación requerida.", code: "reauthentication_required" }, 401);
  try {
    const transferred = await db.$transaction(async tx => {
      const current = await tx.adminUser.findUnique({ where: { id: user.id } });
      const session = await tx.adminSession.findFirst({ where: { id: context.auth.session.id, userId: user.id, revokedAt: null, lockedAt: null, expiresAt: { gt: new Date() }, activeOrganizationId: context.organizationId } });
      if (!current?.active || current.passwordHash !== user.passwordHash || !session) return false;
      const actor = await tx.adminMembership.findFirst({ where: { adminUserId: user.id, organizationId: context.organizationId, active: true, role: "OWNER", organization: { active: true } } });
      const successor = await tx.adminMembership.findFirst({ where: { adminUserId: input.data.targetUserId, organizationId: context.organizationId, active: true, user: { active: true } } });
      if (!actor || !successor) return false;
      // Una sola transacción: nunca ventana sin propietario ni vínculo cross-company.
      await tx.adminMembership.update({ where: { id: successor.id }, data: { role: "OWNER" } });
      await tx.adminMembership.update({ where: { id: actor.id }, data: { role: "ADMIN" } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!transferred) return mobileJSON({ error: "Revalidá sesión, titularidad y sucesor activo.", code: "ownership_changed" }, 409);
    return mobileJSON({ transferred: true, organizationId: context.organizationId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return mobileJSON({ error: "La titularidad cambió durante la operación.", code: "ownership_changed" }, 409);
    throw error;
  }
}
