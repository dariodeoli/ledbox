import { cookies } from "next/headers";
import { db } from "@/lib/server/db";
import { createSession, normalizeUserEmail } from "@/lib/server/auth";
import { getPublicOrigin } from "@/lib/server/public-origin";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url), code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const savedState = (await cookies()).get("ledbox_google_state")?.value;
  const siteUrl = getPublicOrigin(request), loginUrl = `${siteUrl.replace(/\/$/, "")}/admin/login`;
  if (!code || !state || !savedState || state !== savedState) return Response.redirect(`${loginUrl}?error=google_state`);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return Response.redirect(`${loginUrl}?error=google_unconfigured`);
  const redirectUri = `${siteUrl.replace(/\/$/, "")}/api/auth/callback/google`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return Response.redirect(`${loginUrl}?error=google_exchange`);
  const tokens = await tokenResponse.json() as { id_token?: string };
  if (!tokens.id_token) return Response.redirect(`${loginUrl}?error=google_identity`);
  const identityResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
  if (!identityResponse.ok) return Response.redirect(`${loginUrl}?error=google_identity`);
  const identity = await identityResponse.json() as { email?: string; email_verified?: string };
  const email = normalizeUserEmail(identity.email || "");
  if (identity.email_verified !== "true") return Response.redirect(`${loginUrl}?error=google_not_allowed`);
  const user = await db.adminUser.findUnique({ where: { email } });
  if (!user || !user.active) return Response.redirect(`${loginUrl}?error=google_not_allowed`);
  const session = await createSession({ id: user.id, email: user.email, role: user.role });
  const headers = new Headers({ Location: `${siteUrl.replace(/\/$/, "")}/admin` });
  headers.append("Set-Cookie", `ledbox_google_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  headers.append("Set-Cookie", `ledbox_session=${session.jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${session.expiresAt.toUTCString()}`);
  return new Response(null, { status: 302, headers });
}
