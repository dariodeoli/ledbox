import { handleViewBeacon } from "@/lib/server/web-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Beacon de métricas propias (docs/SUPERADMIN.md «Tráfico»). Público, sin CORS abierto,
 * responde siempre 204 y escribe en `after()`. La lógica vive en `lib/server/web-metrics.ts`.
 */
export async function POST(request: Request) {
  return handleViewBeacon(request);
}
