import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { canImportCatalog } from "@/lib/admin-policy";
import { CATALOG_LIMITS, catalogProductForJson, normalizeCatalog, parseCatalogJson, type CatalogCategory, type CatalogCollection, type CatalogProduct, type ImportProblem } from "@/lib/import-catalog";
import { claimImportLote, readBodyLimited, settleImportLote } from "@/lib/server/import-lote";
import { importModule, type ImportModule } from "@/lib/import-modules";
import { readSheetFile, templateCsv, templateXlsx } from "@/lib/server/import-tabular";
import { ImportZipError, readPhotoZip } from "@/lib/server/import-photos";
import { applyCatalog, previewCatalog, type ImportInput } from "@/lib/server/import-catalog";
import { importarEventos } from "@/lib/server/import-eventos-http";
import { analizarImportacion } from "@/lib/server/import-ia";
import { cuotaArchivosOk, salidaPermitida } from "@/lib/server/demo-sandbox";
import { IaError, iaConfig, iaProviderDeConfig } from "@/lib/server/ia-carga";
import { IA_RATE_LIMIT, IA_TEXTO_MAX } from "@/lib/ia-carga";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/admin/import/[modulo]`: «Importar» de cada módulo (hoy `productos`).
 *
 * - `GET`: estado del módulo (¿hay IA?, límites). Con `?formato=xlsx|csv`
 *   descarga la plantilla con las columnas exactas.
 * - `POST` multipart, `accion=preview|apply`. Fuentes de la vista previa
 *   (`fuente`): `json` (catalogo.json), `planilla` (.xlsx/.csv) o `ia` (texto);
 *   opcional `zip` con las fotos. Los tres caminos devuelven el catálogo ya
 *   normalizado (`catalogo`) y la misma vista previa; `apply` recibe ese
 *   `catalogo` (lo que se vio es lo que se aplica) y el mismo `zip`.
 *
 * Solo OWNER y ADMIN con la capacidad del módulo (`inventory.write`; `events.write` en eventos). Todo acotado a la empresa activa.
 */

const TOTAL_BODY_MAX = CATALOG_LIMITS.zipBytes + CATALOG_LIMITS.jsonBytes + CATALOG_LIMITS.sheetBytes + 1024 * 1024;

async function guard(moduloParam: string) {
  const module = importModule(moduloParam);
  if (!module) return { ok: false as const, response: jsonError("Ese módulo todavía no tiene importación.", 404) };
  const auth = await requireAdminContext(module.capability);
  if (!auth.ok) return { ok: false as const, response: auth.response };
  if (!canImportCatalog(auth.context.role)) {
    return { ok: false as const, response: jsonError("Solo el dueño o un administrador puede importar.", 403) };
  }
  return { ok: true as const, module, context: auth.context };
}

export async function GET(request: Request, { params }: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await params;
  const checked = await guard(modulo);
  if (!checked.ok) return checked.response;
  const { module, context } = checked;
  const formato = new URL(request.url).searchParams.get("formato");
  if (formato === "xlsx") {
    return new Response(Buffer.from(templateXlsx(module)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="plantilla-${module.id}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (formato === "csv") {
    return new Response(templateCsv(module), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="plantilla-${module.id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return Response.json({
    modulo: module.id,
    ia: { disponible: Boolean(iaConfig()) && !context.demo && "ok" in (await salidaPermitida({ organizationId: context.organizationId, canal: "ia" })), textoMax: IA_TEXTO_MAX },
    limites: { json: CATALOG_LIMITS.jsonBytes, zip: CATALOG_LIMITS.zipBytes, planilla: CATALOG_LIMITS.sheetBytes, fotos: CATALOG_LIMITS.zipFiles },
  });
}

function fileOf(form: FormData, key: string): File | null {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

const textOf = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

type Source = { ok: true; products: CatalogProduct[]; categories: CatalogCategory[]; collections: CatalogCollection[]; problems: ImportProblem[]; empresa: string | null } | { ok: false; response: Response };

async function readSource(module: ImportModule, form: FormData, accion: string, context: { demo: boolean; organizationId: string }): Promise<Source> {
  const fail = (message: string, status = 400, code?: string): Source => ({ ok: false, response: jsonError(message, status, code) });
  const fuente = accion === "apply" ? "catalogo" : textOf(form, "fuente");
  let raw: unknown;
  if (fuente === "catalogo") {
    try {
      raw = JSON.parse(textOf(form, "catalogo"));
    } catch {
      return fail("Falta el catálogo a aplicar: volvé a generar la vista previa.");
    }
  } else if (fuente === "json") {
    const file = fileOf(form, "json");
    if (!file) return fail("Elegí el archivo catalogo.json.");
    if (file.size > CATALOG_LIMITS.jsonBytes) return fail("El JSON supera los 2 MB.", 413);
    const parsed = parseCatalogJson(await file.text());
    if (!parsed.ok) return fail(parsed.error);
    return { ok: true, products: parsed.value.doc.productos, categories: parsed.value.doc.categorias, collections: parsed.value.doc.colecciones, problems: parsed.value.problems, empresa: parsed.value.doc.empresa };
  } else if (fuente === "planilla") {
    const file = fileOf(form, "planilla");
    if (!file) return fail("Elegí la planilla (.xlsx o .csv).");
    if (file.size > CATALOG_LIMITS.sheetBytes) return fail("La planilla supera los 5 MB.", 413);
    const sheet = readSheetFile(module, new Uint8Array(await file.arrayBuffer()));
    if (!sheet.ok) return fail(sheet.error);
    raw = { productos: sheet.rows };
  } else if (fuente === "ia") {
    // Punto central de salidas (docs/DEMO-INTERACTIVA.md §3): la demo y las sandboxes no mandan nada al proveedor.
    if (context.demo || !("ok" in (await salidaPermitida({ organizationId: context.organizationId, canal: "ia" })))) return fail("La IA no está disponible en la demo.", 403, "ia_bloqueada");
    const config = iaConfig();
    if (!config) return fail("La IA no está configurada en el servidor: pedile a Owncoding que cargue IA_API_KEY.", 503, "ia_no_configurada");
    const texto = textOf(form, "texto").trim();
    if (!texto) return fail("Pegá el texto del catálogo, la factura o la lista.");
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
  const normalized = normalizeCatalog(raw);
  if (!normalized.ok) return fail(normalized.error);
  return { ok: true, products: normalized.value.doc.productos, categories: normalized.value.doc.categorias, collections: normalized.value.doc.colecciones, problems: normalized.value.problems, empresa: normalized.value.doc.empresa };
}

export async function POST(request: Request, { params }: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await params;
  const checked = await guard(modulo);
  if (!checked.ok) return checked.response;
  const { module, context } = checked;
  const { organizationId } = context;

  // Tope real: el `content-length` solo se declara (con chunked puede faltar o mentir), así que
  // el cuerpo se lee con un límite ANTES de `formData()` y se corta apenas lo supera.
  const body = await readBodyLimited(request, TOTAL_BODY_MAX);
  if (!body.ok) return jsonError("Los archivos superan el tamaño permitido (JSON 2 MB, ZIP 60 MB).", 413);
  let form: FormData;
  try {
    form = await new Response(new Blob([body.bytes as BlobPart]), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return jsonError("No pudimos leer los archivos enviados.", 400);
  }
  const accion = textOf(form, "accion");
  if (accion !== "preview" && accion !== "apply") return jsonError("Operación de importación desconocida.", 400);

  const limited = await rateLimit(accion === "apply" ? `import-aplicar:${organizationId}` : `import-vista:${organizationId}`, accion === "apply" ? CATALOG_LIMITS.applyRate : CATALOG_LIMITS.previewRate);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  // Eventos con productos: validación y aplicación propias (lib/server/import-eventos*.ts).
  if (module.id === "eventos") return importarEventos(module, context, form, accion);

  const modeRaw = textOf(form, "modo");
  if (modeRaw && modeRaw !== "CREATE_ONLY" && modeRaw !== "UPSERT") return jsonError("Elegí crear sólo nuevos o crear y actualizar.", 400);
  const importMode = modeRaw === "CREATE_ONLY" ? "CREATE_ONLY" as const : "UPSERT" as const;

  const source = await readSource(module, form, accion, context);
  if (!source.ok) return source.response;

  let photos: Map<string, Uint8Array> | null = null;
  let photoProblems: ImportProblem[] = [];
  const zip = fileOf(form, "zip");
  if (zip) {
    if (zip.size > CATALOG_LIMITS.zipBytes) return jsonError("El ZIP supera los 60 MB.", 413);
    try {
      const read = readPhotoZip(new Uint8Array(await zip.arrayBuffer()));
      photos = read.photos;
      photoProblems = read.problems;
      const bytes = [...read.photos.values()].reduce((sum, data) => sum + data.byteLength, 0);
      if (!(await cuotaArchivosOk(context.organizationId, bytes))) return jsonError("En la demo las fotos superan el espacio disponible (15 MB).", 413);
    } catch (error) {
      if (error instanceof ImportZipError) return jsonError(error.message, 400);
      throw error;
    }
  }
  const input: ImportInput = { products: source.products, categories: source.categories, collections: source.collections, parseProblems: source.problems, photos, photoProblems, importMode };

  if (accion === "preview") {
    const plan = await previewCatalog(organizationId, input);
    return Response.json({
      importMode,
      catalogo: { empresa: source.empresa, moneda: "PYG", productos: source.products.map(catalogProductForJson), ...(source.categories.length ? { categorias: source.categories.map((category) => ({ nombre: category.subcategoria ? `${category.categoria} / ${category.subcategoria}` : category.categoria, foto: category.foto, orden: category.orden })) } : {}), ...(source.collections.length ? { colecciones: source.collections.map((collection) => ({ nombre: collection.nombre, descripcion: collection.descripcion, foto: collection.foto, orden: collection.orden })) } : {}) },
      resumen: plan.summary,
      problemas: plan.problems,
      estados:
        plan.summary.estadosMantenimiento + plan.summary.estadosDanadas + plan.summary.estadosPerdidas + plan.summary.estadosDisponibles > 0
          ? `Estados de unidades: ${plan.summary.estadosMantenimiento} a mantenimiento, ${plan.summary.estadosDanadas} dañadas, ${plan.summary.estadosPerdidas} perdidas, ${plan.summary.estadosDisponibles} vuelven a disponible.`
          : null,
      // Tarjetas y filas genéricas: el panel de importación no conoce el módulo.
      tarjetas: [
        { clave: "crear", etiqueta: "Se crean", valor: plan.summary.crear },
        { clave: "actualizar", etiqueta: "Se actualizan", valor: plan.summary.actualizar },
        { clave: "juegos", etiqueta: "Juegos (combos)", valor: plan.summary.juegos },
        { clave: "fotos", etiqueta: "Fotos encontradas en ZIP", valor: plan.summary.fotos },
        ...(plan.categories.length ? [{ clave: "fotosCategoria", etiqueta: "Fotos de categoría en ZIP", valor: plan.summary.fotosCategoria }] : []),
        ...(plan.summary.fotosExtra ? [{ clave: "fotosExtra", etiqueta: "Fotos adicionales en ZIP", valor: plan.summary.fotosExtra }] : []),
        ...(plan.summary.colecciones ? [{ clave: "colecciones", etiqueta: "Colecciones", valor: plan.summary.colecciones }] : []),
        ...(plan.summary.conEstilo ? [{ clave: "conEstilo", etiqueta: "Productos con estilo", valor: plan.summary.conEstilo }] : []),
        ...(plan.summary.incompletos ? [{ clave: "incompletos", etiqueta: "Juegos incompletos", valor: plan.summary.incompletos }] : []),
        ...(plan.summary.convertidos ? [{ clave: "convertidos", etiqueta: "Unidades que pasan a juego", valor: plan.summary.convertidos }] : []),
        { clave: "omitidos", etiqueta: "Se omiten", valor: plan.summary.omitidos },
      ],
      filas: plan.items.map((item) => ({
        codigo: item.product.codigo,
        nombre: item.product.nombre,
        accion: item.accion,
        conservado: input.importMode === "CREATE_ONLY" && Boolean(item.existingId) && item.accion === "omitir",
        esCombo: item.esCombo,
        stockCountStatus: item.stockCountStatus,
        countBefore: item.countBefore,
        countAfter: item.countAfter,
        detalle: input.importMode === "CREATE_ONLY" && item.existingId && item.accion === "omitir" ? "Sin cambios" : [
          item.incompleto ? "Juego incompleto (sin piezas)" : item.esCombo ? `Juego de ${item.product.componentes.length} componente${item.product.componentes.length === 1 ? "" : "s"}` : "Unidad",
          item.convertir ? "unidad que pasa a juego" : null,
          item.product.precio ? `Gs ${item.product.precio.toLocaleString("es-PY")}` : "precio a consultar",
          item.product.cobro === "dia" ? "por día" : "por evento",
          item.foto ? "con foto" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      zip: Boolean(photos),
    });
  }

  const loteRaw = textOf(form, "lote").trim();
  const lote = /^[0-9a-f-]{36}$/i.test(loteRaw) ? loteRaw : randomUUID();
  const already = await db.auditLog.findFirst({ where: { organizationId, entity: "IaCarga", entityId: lote }, select: { id: true } });
  if (already) return jsonError("Esta importación ya se aplicó. Si cambiaste archivos, generá una vista previa nueva.", 409);
  // El chequeo anterior no es atómico (dos pedidos con el mismo lote pasan a la vez): el candado
  // real es la clave única (empresa, scope, lote) de IdempotencyKey, tomada antes de aplicar.
  const claimed = await claimImportLote(organizationId, lote);
  if (!claimed) return jsonError("Esta importación ya se está aplicando o se aplicó. Si cambiaste archivos, generá una vista previa nueva.", 409);

  // Respuesta en NDJSON: una línea de progreso por bloque y una final con el resultado,
  // así un catálogo grande (cientos de fotos) no queda mudo ni da timeout del proxy.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        send({ progreso: { hecho: 0, total: input.products.length, fase: "Preparando" } });
        const result = await applyCatalog(context, { ...input, lote, onProgress: (progreso) => send({ progreso }) });
        send({ resultado: result });
        await settleImportLote(organizationId, lote, true);
      } catch (error) {
        console.error("[import-catalogo] Falló la aplicación:", error instanceof Error ? error.message : error);
        // Libera el lote: reintentar es seguro (reimportar no duplica).
        await settleImportLote(organizationId, lote, false);
        send({ error: "No pudimos terminar la importación. Revisá el inventario y volvé a intentar: reimportar no duplica." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
