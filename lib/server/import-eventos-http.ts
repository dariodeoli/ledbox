import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { CATALOG_LIMITS } from "@/lib/import-catalog";
import { normalizeEventos, parseEventosJson, type EventoDoc, type EventoProblem } from "@/lib/import-eventos";
import { claimImportLote, settleImportLote } from "@/lib/server/import-lote";
import type { ImportModule } from "@/lib/import-modules";
import { readSheetFile } from "@/lib/server/import-tabular";
import { analizarImportacion } from "@/lib/server/import-ia";
import { salidaPermitida } from "@/lib/server/demo-sandbox";
import { IaError, iaConfig, iaProviderDeConfig } from "@/lib/server/ia-carga";
import { IA_RATE_LIMIT, IA_TEXTO_MAX } from "@/lib/ia-carga";
import { roleCan } from "@/lib/server/permissions";
import type { AdminContext } from "@/lib/server/tenancy";
import { applyEventos, planEventos, type EventoPlan } from "@/lib/server/import-eventos";

/**
 * Rama «eventos» de `/api/admin/import/[modulo]` (POST). Misma mecánica que el catálogo:
 * la vista previa devuelve el documento ya normalizado (`catalogo`) y «Aplicar» recibe ese
 * mismo documento (se vuelve a validar: el cliente no es de fiar), con lote idempotente y
 * respuesta en NDJSON con progreso.
 */

const textOf = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

const fileOf = (form: FormData, key: string): File | null => {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value : null;
};

type Source = { ok: true; eventos: EventoDoc[]; problems: EventoProblem[] } | { ok: false; response: Response };

async function readSource(module: ImportModule, form: FormData, accion: string, context: Pick<AdminContext, "demo" | "organizationId">): Promise<Source> {
  const fail = (message: string, status = 400, code?: string): Source => ({ ok: false, response: jsonError(message, status, code) });
  const fuente = accion === "apply" ? "catalogo" : textOf(form, "fuente");
  let raw: unknown;
  if (fuente === "catalogo") {
    try {
      raw = JSON.parse(textOf(form, "catalogo"));
    } catch {
      return fail("Faltan los eventos a aplicar: volvé a generar la vista previa.");
    }
  } else if (fuente === "json") {
    const file = fileOf(form, "json");
    if (!file) return fail("Elegí el archivo eventos.json.");
    if (file.size > CATALOG_LIMITS.jsonBytes) return fail("El JSON supera los 2 MB.", 413);
    const parsed = parseEventosJson(await file.text(), CATALOG_LIMITS.jsonBytes);
    if (!parsed.ok) return fail(parsed.error);
    return { ok: true, eventos: parsed.value.eventos, problems: parsed.value.problems };
  } else if (fuente === "planilla") {
    const file = fileOf(form, "planilla");
    if (!file) return fail("Elegí la planilla (.xlsx o .csv).");
    if (file.size > CATALOG_LIMITS.sheetBytes) return fail("La planilla supera los 5 MB.", 413);
    const sheet = readSheetFile(module, new Uint8Array(await file.arrayBuffer()));
    if (!sheet.ok) return fail(sheet.error);
    raw = { eventos: sheet.rows };
  } else if (fuente === "ia") {
    if (context.demo || !("ok" in (await salidaPermitida({ organizationId: context.organizationId, canal: "ia" })))) return fail("La IA no está disponible en la demo.", 403, "ia_bloqueada");
    const config = iaConfig();
    if (!config) return fail("La IA no está configurada en el servidor: pedile a Owncoding que cargue IA_API_KEY.", 503, "ia_no_configurada");
    const texto = textOf(form, "texto").trim();
    if (!texto) return fail("Pegá el texto de la agenda de eventos.");
    if (texto.length > IA_TEXTO_MAX) return fail(`El texto supera el máximo de ${IA_TEXTO_MAX.toLocaleString("es-PY")} caracteres.`);
    const limited = await rateLimit(`ia-carga:${context.organizationId}`, IA_RATE_LIMIT);
    if (!limited.allowed) return { ok: false, response: rateLimitResponse(limited.retryAfter) };
    try {
      raw = await analizarImportacion(module, texto, iaProviderDeConfig(config));
    } catch (error) {
      if (error instanceof IaError) return fail(error.message, 502, "ia_proveedor");
      throw error;
    }
  } else {
    return fail("Elegí de dónde importar: JSON, planilla o IA.");
  }
  const normalized = normalizeEventos(raw);
  if (!normalized.ok) return fail(normalized.error);
  return { ok: true, eventos: normalized.value.eventos, problems: normalized.value.problems };
}

const fechaCorta = (day: string) => day.split("-").reverse().join("/");
const ESTADO_TEXTO = { confirmado: "Confirmado", tentativo: "Tentativo", borrador: "Borrador", cancelado: "Cancelado" } as const;

function detalleDe(item: EventoPlan): string {
  const reservadas = item.lineas.filter((line) => !line.sinStock && line.modo !== "sin-reserva" && line.modo !== "liberar").length;
  const sinStock = item.lineas.filter((line) => line.sinStock).length;
  const lineas =
    item.doc.estado === "cancelado"
      ? item.lineas.length ? `libera ${item.lineas.length} línea${item.lineas.length === 1 ? "" : "s"}` : null
      : item.doc.estado === "borrador"
        ? item.lineas.length ? `${item.lineas.length} línea${item.lineas.length === 1 ? "" : "s"} sin reservar` : null
        : `${reservadas} reservada${reservadas === 1 ? "" : "s"}${sinStock ? `, ${sinStock} sin stock` : ""}`;
  return [
    `${fechaCorta(item.doc.desde)} al ${fechaCorta(item.doc.hasta)}`,
    ESTADO_TEXTO[item.doc.estado],
    `${item.cliente.nombre}${item.cliente.nuevo ? " (cliente nuevo)" : ""}`,
    lineas,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function importarEventos(module: ImportModule, context: AdminContext, form: FormData, accion: "preview" | "apply"): Promise<Response> {
  const { organizationId } = context;
  if (context.demo) return jsonError("En la demo no se puede importar.", 403);
  if (!roleCan(context.user.role, "clients.write")) return jsonError("Tu rol no puede crear clientes, y la importación de eventos los crea si no existen.", 403);

  const source = await readSource(module, form, accion, context);
  if (!source.ok) return source.response;

  if (accion === "preview") {
    const plan = await planEventos(context, source.eventos, source.problems, { estimate: true });
    return Response.json({
      catalogo: { eventos: source.eventos.map(({ fila: _fila, ...doc }) => doc) },
      resumen: plan.summary,
      problemas: plan.problems.map((entry) => ({ nivel: entry.nivel, tipo: entry.tipo, codigo: entry.codigo, mensaje: entry.mensaje })),
      estados: "La disponibilidad de la vista previa es una estimación; al aplicar, cada línea se vuelve a comprobar y nunca se sobrevende.",
      tarjetas: [
        { clave: "crear", etiqueta: "Eventos a crear", valor: plan.summary.crear },
        { clave: "actualizar", etiqueta: "Eventos a actualizar", valor: plan.summary.actualizar },
        { clave: "clientesNuevos", etiqueta: "Clientes nuevos", valor: plan.summary.clientesNuevos },
        { clave: "lineasReservadas", etiqueta: "Líneas reservadas", valor: plan.summary.lineasReservadas },
        { clave: "lineasSinStock", etiqueta: "Líneas sin stock", valor: plan.summary.lineasSinStock },
        { clave: "errores", etiqueta: "Errores", valor: plan.summary.errores },
      ],
      filas: plan.items.map((item) => ({ codigo: item.doc.codigo, nombre: item.doc.nombre, accion: item.accion, detalle: detalleDe(item) })),
      zip: false,
    });
  }

  const loteRaw = textOf(form, "lote").trim();
  const lote = /^[0-9a-f-]{36}$/i.test(loteRaw) ? loteRaw : randomUUID();
  const already = await db.auditLog.findFirst({ where: { organizationId, entity: "IaCarga", entityId: lote }, select: { id: true } });
  if (already) return jsonError("Esta importación ya se aplicó. Si cambiaste archivos, generá una vista previa nueva.", 409);
  const claimed = await claimImportLote(organizationId, lote);
  if (!claimed) return jsonError("Esta importación ya se está aplicando o se aplicó. Si cambiaste archivos, generá una vista previa nueva.", 409);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        send({ progreso: { hecho: 0, total: source.eventos.length, fase: "Preparando" } });
        const result = await applyEventos(context, { eventos: source.eventos, lote, onProgress: (progreso) => send({ progreso }) });
        send({ resultado: result });
        await settleImportLote(organizationId, lote, true);
      } catch (error) {
        console.error("[import-eventos] Falló la aplicación:", error instanceof Error ? error.message : error);
        await settleImportLote(organizationId, lote, false);
        send({ error: "No pudimos terminar la importación. Revisá los eventos y volvé a intentar: reimportar no duplica." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
