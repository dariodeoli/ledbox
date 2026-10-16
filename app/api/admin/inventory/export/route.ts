import { requireAdminContext } from "@/lib/server/tenancy";
import { exportInventoryUnits } from "@/lib/server/inventory-unit-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same authenticated inventory access as the list; no costs or supplier contacts. */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  return exportInventoryUnits(auth.context.organizationId);
}
