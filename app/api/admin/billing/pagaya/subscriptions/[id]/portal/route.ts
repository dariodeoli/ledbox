import { createOwnedPortal } from "@/lib/server/pagaya/subscription-management";
import { pagayaBody, pagayaFailure, pagayaJson, pagayaText, requirePagaYaContext } from "@/lib/server/pagaya/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePagaYaContext();
    if (!auth.ok) return auth.response;
    const subscriptionId = pagayaText((await context.params).id);
    const body = await pagayaBody(request, ["enrollmentId"]);
    return pagayaJson(await createOwnedPortal(auth.context, pagayaText(body.enrollmentId), subscriptionId));
  } catch (error) { return pagayaFailure(error); }
}
