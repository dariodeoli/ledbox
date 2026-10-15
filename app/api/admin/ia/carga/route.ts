import { salidaPermitida, SANDBOX_DENIED_MESSAGE } from "@/lib/server/demo-sandbox";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { clientLogoUrl } from "@/lib/admin-types";
import { inventoryImageUrl } from "@/lib/server/inventory-images";
import {
  IaError,
  analizarCarga,
  asignarExistentes,
  iaConfig,
  iaProviderDeConfig,
  tiposPermitidos,
} from "@/lib/server/ia-carga";
import { IA_RATE_LIMIT, IA_TEXTO_MAX } from "@/lib/ia-carga";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Carga con IA» (issue #120): análisis de un texto pegado.
 *
 * - `GET`: estado de configuración y tipos que el rol puede crear (lo consulta
 *   el diálogo al abrir; sin `IA_API_KEY` avisa claro y no rompe nada).
 * - `POST`: manda el texto al proveedor configurado y devuelve los registros
 *   detectados y normalizados para la vista previa. **No crea nada**: el panel
 *   confirma con los endpoints existentes (permisos, aislamiento y auditoría
 *   iguales). Rate-limit por organización; el texto no se persiste.
 */

/** Tipos que el rol puede crear; `null` cuando no puede usar el asistente. */
async function contextoDelAsistente() {
  const auth = await requireAdminContext();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const tipos = tiposPermitidos(auth.context.role);
  if (tipos.length === 0) {
    return {
      ok: false as const,
      response: jsonError("Tu rol no puede crear clientes, eventos ni productos.", 403),
    };
  }
  return { ok: true as const, auth, tipos };
}

export async function GET() {
  const asistente = await contextoDelAsistente();
  if (!asistente.ok) return asistente.response;
  const config = iaConfig();
  return Response.json({
    configurada: Boolean(config),
    modelo: config?.modelo ?? null,
    tipos: asistente.tipos,
  });
}

export async function POST(request: Request) {
  const asistente = await contextoDelAsistente();
  if (!asistente.ok) return asistente.response;
  const { auth, tipos } = asistente;

  const limited = await rateLimit(`ia-carga:${auth.context.organizationId}`, IA_RATE_LIMIT);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  // Salida hacia un proveedor externo con la clave del servidor: una sandbox de la demo no la usa
  // (docs/DEMO-INTERACTIVA.md §3).
  const salida = await salidaPermitida({ organizationId: auth.context.organizationId, canal: "ia" });
  if ("simulado" in salida) return jsonError(SANDBOX_DENIED_MESSAGE, 403, "demo_ia");

  const config = iaConfig();
  if (!config) {
    return jsonError(
      "La IA no está configurada en el servidor: pedile a Owncoding que cargue IA_API_KEY (o desactivá la función).",
      503,
      "ia_no_configurada",
    );
  }

  const body = (await readJson(request)) as Record<string, unknown> | null;
  const texto = typeof body?.texto === "string" ? body.texto.trim() : "";
  if (!texto) return jsonError("Pegá el texto que querés cargar.", 400);
  if (texto.length > IA_TEXTO_MAX) {
    return jsonError(`El texto supera el máximo de ${IA_TEXTO_MAX.toLocaleString("es-PY")} caracteres.`, 400);
  }

  let analisis;
  try {
    analisis = await analizarCarga({ texto, tipos, proveedor: iaProviderDeConfig(config) });
  } catch (error) {
    if (error instanceof IaError) return jsonError(error.message, 502, "ia_proveedor");
    throw error;
  }

  // Matching contra lo existente (issue #122): clientes por nombre/empresa/RUC/
  // teléfono y productos por nombre/SKU/categoría, con el aislamiento de la
  // empresa activa. Los datos no salen al proveedor: el match corre acá.
  const [clientes, productos] = await Promise.all([
    db.client.findMany({
      where: { organizationId: auth.context.organizationId, active: true },
      orderBy: { name: "asc" },
      take: 1000,
      select: { id: true, name: true, company: true, ruc: true, phone: true, logo: { select: { updatedAt: true } } },
    }),
    db.inventoryItem.findMany({
      where: { organizationId: auth.context.organizationId },
      orderBy: { name: "asc" },
      take: 2000,
      select: { id: true, name: true, sku: true, category: true, imageUrl: true, imageMime: true, updatedAt: true },
    }),
  ]);
  const registros = asignarExistentes(analisis, {
    clientes: clientes.map((cliente) => ({
      id: cliente.id,
      nombre: cliente.name,
      empresa: cliente.company,
      ruc: cliente.ruc,
      telefono: cliente.phone,
      // Logo para el preview (issue #125); sin logo queda el monograma.
      imagenUrl: cliente.logo ? clientLogoUrl(cliente.id, cliente.logo.updatedAt) : null,
    })),
    productos: productos.map((producto) => ({
      id: producto.id,
      nombre: producto.name,
      sku: producto.sku,
      categoria: producto.category,
      // Foto del ítem (subida o URL manual) para la miniatura del preview.
      imagenUrl: inventoryImageUrl({
        id: producto.id,
        imageUrl: producto.imageUrl,
        imageMime: producto.imageMime,
        updatedAt: producto.updatedAt,
      }),
    })),
  });

  // Traza de la transferencia al encargado (Ley 7593/2025, docs/PRIVACIDAD.md
  // T10): se auditan los conteos y el modelo, nunca el texto pegado.
  await recordAudit({
    context: auth.context,
    action: "send",
    entity: "IaCarga",
    entityId: randomUUID(),
    summary: `Analizó un texto con la IA (${registros.clientes.length} clientes, ${registros.eventos.length} eventos, ${registros.productos.length} productos, ${registros.cobros.length} cobros)`,
    detail: {
      fields: {
        modelo: config.modelo,
        clientes: registros.clientes.length,
        eventos: registros.eventos.length,
        productos: registros.productos.length,
        cobros: registros.cobros.length,
      },
    },
  });

  return Response.json({ registros });
}
