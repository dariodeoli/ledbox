import { mobileContext } from "@/lib/server/mobile/session";
import { mobileEvents, mobileReadQuery } from "@/lib/server/mobile/events";
import { mobileJSON } from "@/lib/server/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = await mobileContext(request);
  if (!context.ok) return context.response;
  const query = mobileReadQuery(new URL(request.url), false);
  if (!query) return mobileJSON({ error: "Consulta inválida.", code: "invalid_query" }, 400);
  return mobileJSON(await mobileEvents(context.organizationId, query));
}
