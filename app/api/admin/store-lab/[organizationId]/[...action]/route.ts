import { requireStoreLab } from "@/lib/server/store-lab";
import { dispatchStoreLab } from "@/lib/store-lab-http";
import { priceStoreCart } from "@/lib/server/store-cart";
import { loadProductDetail } from "@/lib/server/catalog-product";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; action: string[] }> };
async function handle(request: Request, { params }: Context) {
  const { organizationId, action } = await params;
  const auth = await requireStoreLab(organizationId);
  if (!auth.ok) return auth.response;
  return dispatchStoreLab(request, action, {
    price: (raw) => priceStoreCart(auth.context, raw),
    product: (code) => loadProductDetail(auth.context, code),
  });
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
