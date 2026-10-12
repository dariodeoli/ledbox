import { getPagaYaCatalog } from "@/lib/server/pagaya/catalog-checkout";
import { pagayaFailure, pagayaJson, requirePagaYaContext } from "@/lib/server/pagaya/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requirePagaYaContext();
    if (!auth.ok) return auth.response;
    return pagayaJson(await getPagaYaCatalog(auth.context));
  } catch (error) { return pagayaFailure(error); }
}
