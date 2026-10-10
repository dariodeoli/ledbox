import { db } from "@/lib/server/db";
import { mobileSession } from "@/lib/server/mobile/session";
import { mobileJSON } from "@/lib/server/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const auth = await mobileSession(request);
  if (!auth) return mobileJSON({ error: "Unauthorized", code: "unauthorized" }, 401);
  await db.adminSession.updateMany({ where: { id: auth.session.id, userId: auth.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return mobileJSON({ loggedOut: true });
}
