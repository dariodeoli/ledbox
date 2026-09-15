import { clearSessionCookie, revokeCurrentSession } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await revokeCurrentSession();
  await clearSessionCookie();
  return Response.json({ ok: true });
}
