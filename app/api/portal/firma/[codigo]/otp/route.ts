import { jsonError, readJson } from "@/lib/server/http";
import {
  loadSignaturePortal,
  sendSignatureOtp,
  signatureClientEvidence,
  signatureJsonError,
  verifySignatureOtp,
} from "@/lib/server/signature/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/portal/firma/[codigo]/otp` (issue #79): verificación por correo.
 * Body: `{ action: "send" }` para enviar (o reenviar) el código de 6 dígitos, o
 * `{ action: "verify", otp }` para validarlo. Con el código validado la
 * solicitud queda habilitada para firmar.
 */
export async function POST(request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const body = (await readJson(request)) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const evidence = signatureClientEvidence(request.headers);
  try {
    if (action === "send") {
      const { demoOtp, ...signature } = await sendSignatureOtp({ code: codigo, evidence });
      // `demoOtp` solo existe en una sandbox de la demo (el correo se simula y el código se muestra en pantalla).
      return Response.json({ signature, ...(demoOtp !== undefined ? { demoOtp } : {}) });
    }
    if (action === "verify") {
      await verifySignatureOtp({ code: codigo, evidence, otp: String(body.otp ?? "") });
      const signature = await loadSignaturePortal(codigo);
      if (!signature) return jsonError("El enlace no es válido o la solicitud no existe.", 404);
      return Response.json({ signature });
    }
    return jsonError("Acción de verificación desconocida.", 400);
  } catch (error) {
    return signatureJsonError(error);
  }
}
