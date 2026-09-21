import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { budgetReference } from "@/lib/admin-format";
import { paymentProofFileName } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/budgets/proofs/[id]` (issue #17): sirve el archivo del
 * comprobante **con sesión** (cualquier rol de la empresa activa, VIEWER
 * incluido: es lectura). Se entrega `inline` para verlo en el visor del panel,
 * con el `Content-Type` real detectado al subirlo, un nombre de archivo estable
 * y `no-store`: un comprobante de pago no se cachea en intermediarios.
 *
 * Un id de otra empresa no existe para esta consulta (404), igual que uno
 * inexistente.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const proof = await db.budgetPaymentProof.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true, budgetId: true, mime: true, size: true, createdAt: true, data: true },
  });
  if (!proof) return jsonError("No encontramos ese comprobante.", 404);

  const filename = paymentProofFileName(proof.mime, proof.createdAt, budgetReference(proof.budgetId));
  return new Response(new Uint8Array(proof.data), {
    status: 200,
    headers: {
      "Content-Type": proof.mime,
      "Content-Length": String(proof.size),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
