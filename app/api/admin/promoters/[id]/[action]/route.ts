import { handleCrmAction } from "@/lib/server/trash-crm-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Papelera (Promoter): `POST /api/admin/promoters/[id]/[action]` con archive, unarchive, trash, restore, purge y anonymize (docs/PAPELERA.md). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  return handleCrmAction("Promoter", request, params);
}
