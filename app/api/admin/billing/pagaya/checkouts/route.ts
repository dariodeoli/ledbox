import { createCatalogCheckout, getOwnedCheckout } from "@/lib/server/pagaya/catalog-checkout";
import { pagayaBody, pagayaFailure, pagayaJson, pagayaText, requirePagaYaContext } from "@/lib/server/pagaya/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requirePagaYaContext();
    if (!auth.ok) return auth.response;
    const body = await pagayaBody(request, ["enrollmentId", "intentId"]);
    const result = await createCatalogCheckout(auth.context, pagayaText(body.enrollmentId), pagayaText(body.intentId));
    return pagayaJson(result, result.state === "UNKNOWN" || result.state === "SUBMITTING" ? 202 : 200);
  } catch (error) { return pagayaFailure(error); }
}

export async function GET(request: Request) {
  try {
    const auth = await requirePagaYaContext();
    if (!auth.ok) return auth.response;
    const enrollmentId = pagayaText(new URL(request.url).searchParams.get("enrollmentId"));
    return pagayaJson(await getOwnedCheckout(auth.context, enrollmentId));
  } catch (error) { return pagayaFailure(error); }
}
