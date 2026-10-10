import { jsonError } from "@/lib/server/http";
import { loadSignaturePortal, signatureClientEvidence, signatureJsonError } from "@/lib/server/signature/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lectura pública del mismo documento verificado que dibuja el portal, con código y rate limit. */
export async function GET(request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  try {
    const signature = await loadSignaturePortal(codigo, { evidence: signatureClientEvidence(request.headers) });
    if (!signature) return jsonError("No encontramos esa solicitud.", 404);
    return Response.json({ signature }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return signatureJsonError(error);
  }
}
