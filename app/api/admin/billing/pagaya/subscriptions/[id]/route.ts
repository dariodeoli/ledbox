import { PagaYaError } from "@/lib/server/pagaya/pagaya-server.mjs";
import { getOwnedSubscription, setOwnedRenewal } from "@/lib/server/pagaya/subscription-management";
import { pagayaBody, pagayaFailure, pagayaJson, pagayaText, requirePagaYaContext } from "@/lib/server/pagaya/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const auth = await requirePagaYaContext();
    if (!auth.ok) return auth.response;
    const subscriptionId = pagayaText((await context.params).id);
    const enrollmentId = pagayaText(new URL(request.url).searchParams.get("enrollmentId"));
    return pagayaJson(await getOwnedSubscription(auth.context, enrollmentId, subscriptionId));
  } catch (error) { return pagayaFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const auth = await requirePagaYaContext();
    if (!auth.ok) return auth.response;
    const subscriptionId = pagayaText((await context.params).id);
    const body = await pagayaBody(request, ["enrollmentId", "intentId", "cancelAtPeriodEnd"]);
    if (typeof body.cancelAtPeriodEnd !== "boolean") throw new PagaYaError("invalid_request", { status: 400 });
    const result = await setOwnedRenewal(auth.context, pagayaText(body.enrollmentId), subscriptionId,
      pagayaText(body.intentId), body.cancelAtPeriodEnd);
    return pagayaJson(result, result.state === "UNKNOWN" || result.state === "SUBMITTING" ? 202 : 200);
  } catch (error) { return pagayaFailure(error); }
}
