import { randomBytes } from "node:crypto";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  if (!clientId) return new Response("Google login is not configured.", { status: 503 });
  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${siteUrl.replace(/\/$/, "")}/api/auth/callback/google`;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  const headers = new Headers({ Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  headers.append("Set-Cookie", `ledbox_google_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  return new Response(null, { status: 302, headers });
}
