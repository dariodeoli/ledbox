import { hostnameOf, publicConfig } from "@/lib/public-config";
import { isSandboxOrg } from "./demo-sandbox";

/**
 * Host de la demo (docs/DEMO-INTERACTIVA.md §2). La sandbox solo existe en el host demo: la cookie
 * `ledbox_demo` es propia de ese host, el portal y la firma de una sandbox dan 404 en los demás.
 * En desarrollo la demo vive en `demo.localhost:3000`.
 */

/** ¿`host` (con o sin puerto) es el de la demo? */
export function isDemoHostName(host: string | null | undefined): boolean {
  const name = String(host ?? "").split(",")[0].trim().toLowerCase().split(":")[0];
  if (!name) return false;
  if (name === hostnameOf(publicConfig.demoUrl)) return true;
  return process.env.NODE_ENV !== "production" && (name === "demo.localhost" || name.endsWith(".demo.localhost"));
}

/** Host del pedido actual (`x-forwarded-host` primero, como el middleware); `""` fuera de un request. */
export async function currentRequestHost(): Promise<string> {
  try {
    // Import diferido: este módulo lo cargan también el portal y el correo, que no corren dentro de un request.
    const { headers } = await import("next/headers");
    const list = await headers();
    return (list.get("x-forwarded-host") || list.get("host") || "").split(",")[0].trim().toLowerCase();
  } catch {
    return "";
  }
}

export async function onDemoHost(): Promise<boolean> {
  return isDemoHostName(await currentRequestHost());
}

/**
 * Criterio 18: una sandbox no se ve fuera del host demo (portal del presupuesto, firma, comparativas).
 * Fuera de un request (pruebas, tareas) no hay host y no oculta nada.
 */
export async function sandboxHiddenHere(organizationId: string | null | undefined, hostOverride?: string): Promise<boolean> {
  const host = hostOverride ?? (await currentRequestHost());
  if (!host) return false;
  if (isDemoHostName(host)) return false;
  return isSandboxOrg(organizationId);
}
