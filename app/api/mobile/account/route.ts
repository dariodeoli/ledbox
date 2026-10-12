import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/auth";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { mobileSession } from "@/lib/server/mobile/session";
import { mobileDeleteSchema } from "@/lib/server/mobile/contracts";
import { mobileInput, mobileJSON } from "@/lib/server/mobile/http";
import { deleteMobileIdentity, MobileDeletionError } from "@/lib/server/mobile/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request) {
  const auth = await mobileSession(request);
  if (!auth) return mobileJSON({ error: "Unauthorized", code: "unauthorized" }, 401);
  const limited = await rateLimit(`mobile:delete:${auth.user.id}`, 5);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const input = await mobileInput(request, mobileDeleteSchema);
  if (!input.ok) return input.response;
  const user = await db.adminUser.findUnique({ where: { id: auth.user.id } });
  if (!user?.active || !(await verifyPassword(input.data.password, user.passwordHash))) return mobileJSON({ error: "Reautenticación requerida.", code: "reauthentication_required" }, 401);
  try {
    await db.$transaction(tx => deleteMobileIdentity(tx, { userId: user.id, sessionId: auth.session.id, verifiedPasswordHash: user.passwordHash }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return mobileJSON({ deleted: true, retained: ["organization_records", "financial_records", "signed_documents", "audit_history"] });
  } catch (error) {
    if (error instanceof MobileDeletionError) return mobileJSON({ error: error.code === "OWNER_TRANSFER_REQUIRED" ? "Transferí la titularidad antes de eliminar la cuenta." : "Reautenticación requerida.", code: error.code }, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return mobileJSON({ error: "La cuenta cambió durante la operación. Volvé a confirmar.", code: "account_changed" }, 409);
    throw error;
  }
}
