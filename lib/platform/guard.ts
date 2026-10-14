import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/server/db";
import { getAuthenticatedAdmin } from "@/lib/server/auth";
import { decidePlatformAccess } from "@/lib/platform/access";

/**
 * Guard único del panel de plataforma (docs/SUPERADMIN.md §2). Solo cookie: nunca
 * lee `Authorization`, así que una API key no entra. Relee el usuario en la base y,
 * ante cualquier falla o excepción, redirige a "/" (ni 404 ni mensajes que delaten el panel).
 * Lo llaman el layout, cada page, cada server action y cada route de `app/(superadmin)`.
 */
export async function requirePlatformAdmin(): Promise<{ userId: string; email: string }> {
  let granted: { userId: string; email: string } | null = null;
  try {
    const auth = await getAuthenticatedAdmin();
    if (auth) {
      const user = await db.adminUser.findUnique({
        where: { id: auth.user.id },
        select: { id: true, active: true, email: true, emailVerifiedAt: true },
      });
      const requestHeaders = await headers();
      const decision = decidePlatformAccess({
        user,
        session: auth.session,
        host: requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"),
        isProd: process.env.NODE_ENV === "production",
      });
      if (user && decision.ok) granted = { userId: user.id, email: user.email };
    }
  } catch (error) {
    console.warn("[platform] guard falló; se deniega el acceso", error instanceof Error ? error.message : error);
  }
  // `redirect` lanza: va fuera del try para que no lo capture el catch.
  if (!granted) redirect("/");
  return granted;
}
