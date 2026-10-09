import { rateLimit, getClientIp } from "@/lib/server/rate-limit";
import { consultarRucProveedor, normalizarRuc, proveedorRucConfigurado, rucConForma } from "@/lib/server/ruc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuota pública: 10 consultas cada 15 minutos por IP (misma ventana que /api/leads). */
const LIMITE = 10;

/** Respuesta de error con la marca que habilita la carga manual en el formulario. */
function errorRuc(mensaje: string, status: number): Response {
  return Response.json({ error: mensaje, manualEntryAllowed: true }, { status });
}

/**
 * `GET /api/ruc?numero=80012345-6` — razón social de un RUC para el formulario
 * público de consulta (issue #104). Sin sesión: rate-limit por IP, sin traza de
 * datos (la única huella es el bucket del rate-limit) y respuesta acotada a la
 * razón social y el RUC completo. Si el proveedor no está configurado o falla,
 * responde con `manualEntryAllowed: true` y el formulario se completa a mano.
 */
export async function GET(request: Request) {
  const limited = await rateLimit(`ruc:consulta:${getClientIp(request)}`, LIMITE);
  if (!limited.allowed) return Response.json({ error: "Alcanzaste el límite de consultas. Completá los datos a mano.", manualEntryAllowed: true }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });

  const numero = normalizarRuc(new URL(request.url).searchParams.get("numero"));
  if (!rucConForma(numero)) {
    return errorRuc("Ingresá un RUC válido: 5 a 8 dígitos, con o sin dígito verificador.", 400);
  }
  if (!proveedorRucConfigurado()) {
    return errorRuc("La consulta de RUC no está configurada. Completá los datos a mano.", 503);
  }

  try {
    const datos = await consultarRucProveedor(numero);
    if (!datos) return errorRuc("No encontramos la razón social de este RUC. Completá los datos a mano.", 404);
    return Response.json({ ...datos, fullRuc: datos.fullRuc ?? numero });
  } catch {
    return errorRuc("No pudimos consultar el RUC. Completá los datos a mano.", 502);
  }
}
