import { db } from "./db";

/**
 * Bloqueos de la demo interactiva por visitante (docs/DEMO-INTERACTIVA.md §3).
 *
 * Vocabulario (documentado acá, una sola vez):
 * - **Vitrina**: la empresa `demo` (`org_demo`, `isDemo = true`, sin `demoParentId`). Es de solo lectura
 *   (`context.demo`), como hoy.
 * - **Sandbox**: la copia por visitante (`isDemo = true` **y** `demoParentId != null`). Escribe
 *   (`context.sandbox`), pero toda salida hacia afuera queda cortada acá: correo, WhatsApp, pagos,
 *   SIFEN y webhooks pasan por `salidaPermitida`; los archivos tienen tope total.
 *
 * Hoy ninguna empresa es sandbox hasta que E2 las cree; este módulo no cambia nada visible antes.
 */

/** Motivo que se registra y se muestra cuando una salida se simula. */
export const DEMO_SIMULADO = "Demo: simulado";
/** Tope total de archivos (`Bytes`) por sandbox. */
export const SANDBOX_FILE_QUOTA_BYTES = 15 * 1024 * 1024;
/** Mensaje del 403 de las rutas prohibidas en una sandbox. */
export const SANDBOX_DENIED_MESSAGE = "En la demo esto está desactivado";
export const SANDBOX_QUOTA_MESSAGE = "La demo llegó al tope de 15 MB de archivos. Quitá alguno o reiniciá la demo.";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { sandbox: boolean; expires: number }>();

/** Vacía la caché de `isSandboxOrg` (pruebas y purga). */
export function clearSandboxCache(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}

/** ¿La empresa es una sandbox de la demo? Caché de 60 s por proceso. */
export async function isSandboxOrg(organizationId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!organizationId) return false;
  const hit = cache.get(organizationId);
  if (hit && hit.expires > now) return hit.sandbox;
  const row = await db.organization.findUnique({
    where: { id: organizationId },
    select: { isDemo: true, demoParentId: true },
  });
  const sandbox = Boolean(row?.isDemo && row.demoParentId);
  cache.set(organizationId, { sandbox, expires: now + CACHE_TTL_MS });
  return sandbox;
}

export type SalidaCanal = "mail" | "whatsapp" | "pago" | "sifen" | "webhook";
export type SalidaPermitida = { ok: true } | { simulado: true; motivo: string };

/** ¿El destino es de la demo (`*.demo`)? Vale para correos (`a@x.demo`) y hosts (`x.demo`). */
export function destinoDemo(destino: string | null | undefined): boolean {
  const value = String(destino ?? "").trim().toLowerCase();
  if (!value) return false;
  const host = value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : value.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0];
  return host === "demo" || host.endsWith(".demo");
}

/**
 * Punto central de toda salida hacia afuera. En una sandbox, o hacia un destino `*.demo` de
 * cualquier empresa, no sale nada: el llamador registra «Demo: simulado» y sigue.
 * Todo canal nuevo (PagaYa, SIFEN, webhooks) debe pasar por acá (lo exige `tests/demo-salidas.test.ts`).
 */
export async function salidaPermitida(input: {
  organizationId: string | null | undefined;
  canal: SalidaCanal;
  destino?: string | null;
}): Promise<SalidaPermitida> {
  if (destinoDemo(input.destino) || (await isSandboxOrg(input.organizationId))) {
    return { simulado: true, motivo: DEMO_SIMULADO };
  }
  return { ok: true };
}

/**
 * Suma de bytes de archivos de la empresa (`octet_length` de las columnas `Bytes`): logos de la empresa
 * y de clientes, avatares de la sandbox, comprobantes, adjuntos, evidencias de firma e imágenes de inventario.
 */
export async function bytesDeArchivos(organizationId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT (
      COALESCE((SELECT SUM(octet_length("data")) FROM "OrganizationLogo" WHERE "organizationId" = ${organizationId}), 0)
      + COALESCE((SELECT SUM(octet_length(l."data")) FROM "ClientLogo" l JOIN "Client" c ON c."id" = l."clientId" WHERE c."organizationId" = ${organizationId}), 0)
      + COALESCE((SELECT SUM(octet_length("data")) FROM "BudgetPaymentProof" WHERE "organizationId" = ${organizationId}), 0)
      + COALESCE((SELECT SUM(octet_length("data")) FROM "BudgetAttachment" WHERE "organizationId" = ${organizationId}), 0)
      + COALESCE((SELECT SUM(octet_length("data")) FROM "SignatureEvidence" WHERE "organizationId" = ${organizationId}), 0)
      + COALESCE((SELECT SUM(octet_length("imageData")) FROM "InventoryItem" WHERE "organizationId" = ${organizationId}), 0)
      + COALESCE((SELECT SUM(octet_length(a."data")) FROM "AdminUserAvatar" a JOIN "AdminUser" u ON u."id" = a."userId" WHERE u."demoOrganizationId" = ${organizationId}), 0)
    )::bigint AS total`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * ¿Cabe `bytes` más en el tope de la sandbox? Fuera de una sandbox siempre es `true` (rigen los topes
 * por archivo de cada ruta). Toda ruta que escribe columnas `Bytes` la llama antes de guardar y,
 * si da `false`, responde 413 con `SANDBOX_QUOTA_MESSAGE`.
 */
export async function cuotaArchivosOk(organizationId: string, bytes: number): Promise<boolean> {
  if (!(await isSandboxOrg(organizationId))) return true;
  return (await bytesDeArchivos(organizationId)) + Math.max(0, bytes) <= SANDBOX_FILE_QUOTA_BYTES;
}
