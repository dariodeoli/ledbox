/**
 * «Importar catálogo»: contrato y reglas puras (sin React, sin base, sin Node).
 *
 * Los tres caminos de entrada (JSON de ChatGPT, planilla .xlsx/.csv e IA de
 * LedBox) terminan en `normalizeCatalog`, y de ahí en `planCatalog`: la misma
 * vista previa, con los mismos problemas, para cualquier origen. Las reglas de
 * campo (nombre, SKU, precio en PYG entero) son las del alta de inventario
 * (`lib/field-rules.ts`); acá no se duplican.
 */

import { PRICE_TIER_MAX_DAYS, PRICE_TIER_MAX_ROWS, PRICE_TIER_PRICE_MAX, sortTiers, type PriceTier } from "@/lib/price-tiers";
import { categoryPathKey, parseCategoryInput } from "@/lib/inventory-categories";
import { COLLECTIONS_MAX, COLLECTION_DESCRIPTION_MAX, COLLECTION_NAME_MAX, COLLECTION_ORDER_MAX, collectionSlug } from "@/lib/collections";
import { TAGS_MAX, parseTags } from "@/lib/store-tags";
import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
  normalizeWarehouseCode,
  readInventoryLocation,
  warehouseCodeValid,
  inventoryPriceValue,
  inventorySkuValid,
  normalizeInventorySku,
  normalizePersonName,
  personNameValid,
} from "@/lib/field-rules";

export const CATALOG_LIMITS = {
  /** `catalogo.json`: 2 MB. */
  jsonBytes: 2 * 1024 * 1024,
  /** `fotos.zip`: 60 MB. */
  zipBytes: 60 * 1024 * 1024,
  /** Planilla .xlsx/.csv. */
  sheetBytes: 5 * 1024 * 1024,
  /** Archivos dentro del ZIP. */
  zipFiles: 400,
  /** Una foto cruda dentro del ZIP. */
  photoBytes: 12 * 1024 * 1024,
  /** Total descomprimido del ZIP (defensa contra bombas de compresión). */
  zipInflatedBytes: 150 * 1024 * 1024,
  /** Productos por importación. */
  products: 1000,
  /** Categorías declaradas por importación. */
  categories: 200,
  /** Fotos extra por producto (además de la principal). */
  extraPhotos: 8,
  /** Componentes por juego. */
  components: 60,
  /** Llamadas por empresa y ventana (15 min). */
  previewRate: 20,
  applyRate: 10,
} as const;

export type CatalogComponent = { codigo: string; cantidad: number };
export type CatalogImportMode = "CREATE_ONLY" | "UPSERT";

export type CatalogProduct = {
  codigo: string;
  nombre: string;
  /** Categoría principal. «Categoría / Subcategoría» en una sola columna se separa acá. */
  categoria: string;
  /** Subcategoría (un nivel dentro de la categoría), o `null`. */
  subcategoria: string | null;
  /** Código del depósito donde se guardan las unidades nuevas (opcional). */
  deposito: string | null;
  /** Ubicación dentro del depósito, ya normalizada («E3-B2»), o `null`. */
  ubicacion: string | null;
  tipo: "juego" | "unidad" | null;
  /** Guaraníes enteros; `null` = sin dato. */
  precio: number | null;
  /** Cómo se cobra: por evento (por defecto) o por día. */
  cobro: "evento" | "dia";
  /**
   * «Precio por días» del cliente final: `precios_dias: [{desde_dias, modo: "dia"|"total", precio}]`.
   * Vacío/ausente = no toca los escalones que el producto ya tenga.
   */
  preciosDias?: PriceTier[];
  cantidad: number | null;
  /**
   * Estados de unidad deseados (solo productos «unidad»): enteros ≥ 0. `null` = el archivo no trae el
   * campo (no se toca el estado); `0` = devolver a disponible las que estén en ese estado.
   */
  enMantenimiento: number | null;
  danadas: number | null;
  perdidas: number | null;
  medidas: string | null;
  capacidad: string | null;
  descripcion: string | null;
  componentes: CatalogComponent[];
  foto: string | null;
  /**
   * Fotos extra, en orden (`"fotos": ["527.jpg", "527-2.jpg"]`). `null` = el archivo no trae el campo (no se tocan las
   * que ya tiene); una lista, aunque vacía, las reemplaza. Si no hay `foto`, la primera de `fotos` es la principal.
   */
  fotos: string[] | null;
  /** Nombres de las colecciones del producto (`"colecciones"`), o `null` si el archivo no trae el campo. */
  colecciones: string[] | null;
  /** Estilos o colores para filtrar (`"estilo"`), o `null` si el archivo no trae el campo. */
  estilo: string[] | null;
  pagina: number | null;
  dudas: string | null;
  /** Posición (1-based) en el archivo de origen. */
  fila: number;
};

/** Colección declarada en la sección opcional `colecciones` del JSON (`[{ nombre, descripcion, foto, orden }]`). */
export type CatalogCollection = {
  nombre: string;
  descripcion: string | null;
  /** Nombre de la foto de ambientación dentro del ZIP, o `null`. */
  foto: string | null;
  orden: number | null;
  /** Posición (1-based) en la lista `colecciones`. */
  fila: number;
};

/** Categoría declarada en la sección opcional `categorias` del JSON (foto propia y orden). */
export type CatalogCategory = {
  /** Categoría principal. */
  categoria: string;
  /** Subcategoría si el nombre venía como «Categoría / Subcategoría». */
  subcategoria: string | null;
  /** Nombre de la foto dentro del ZIP, o `null`. */
  foto: string | null;
  /** Posición (`sortOrder`) o `null` = no se toca. */
  orden: number | null;
  /** Posición (1-based) en la lista `categorias`. */
  fila: number;
};

export type CatalogDoc = { empresa: string | null; moneda: string; productos: CatalogProduct[]; categorias: CatalogCategory[]; colecciones: CatalogCollection[] };

export type ProblemKind =
  | "codigo-repetido"
  | "codigo-invalido"
  | "nombre-invalido"
  | "tipo-invalido"
  | "cobro-invalido"
  | "precios-dias-invalido"
  | "precio-invalido"
  | "precio-cero"
  | "cantidad-invalida"
  | "estado-invalido"
  | "estado-excede"
  | "estado-incompleto"
  | "estado-ignorado"
  | "existente-conservado"
  | "componente-inexistente"
  | "componente-invalido"
  | "juego-anidado"
  | "juego-sin-componentes"
  | "categoria-invalida"
  | "categoria-repetida"
  | "categoria-foto-faltante"
  | "coleccion-invalida"
  | "coleccion-repetida"
  | "coleccion-foto-faltante"
  | "coleccion-sin-declarar"
  | "estilo-invalido"
  | "fotos-exceso"
  | "juego-no-convertible"
  | "juego-convertido"
  | "deposito-invalido"
  | "deposito-inexistente"
  | "ubicacion-invalida"
  | "tipo-corregido"
  | "cambia-de-tipo"
  | "sku-papelera"
  | "foto-faltante"
  | "foto-invalida"
  | "foto-sobrante"
  | "foto-sin-zip"
  | "descripcion-larga"
  | "duda"
  | "fila-invalida"
  | "moneda"
  | "archivo";

export type ImportProblem = {
  nivel: "error" | "aviso";
  tipo: ProblemKind;
  codigo: string | null;
  fila: number | null;
  mensaje: string;
  /** Solo en las dudas: motivo agrupado para filtrar en la vista previa. */
  motivo?: DudaMotivo;
};

export const DUDA_MOTIVOS = ["precio", "foto", "codigo", "componentes", "medidas", "cantidad", "otro"] as const;
export type DudaMotivo = (typeof DUDA_MOTIVOS)[number];
export const DUDA_MOTIVO_LABEL: Record<DudaMotivo, string> = {
  precio: "Precio",
  foto: "Foto",
  codigo: "Código o nombre",
  componentes: "Componentes o juego",
  medidas: "Medidas o capacidad",
  cantidad: "Cantidad",
  otro: "Otras",
};

/** Agrupa una duda libre de ChatGPT por motivo (palabras clave; sin match = «otro»). */
export function dudaMotivo(text: string): DudaMotivo {
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\bprecio|\bcosto|\bvalor|gs\b|guarani|\bmoneda|\bmonto/.test(t)) return "precio";
  if (/\bfoto|imagen|\bimg\b|borros|ilegible/.test(t)) return "foto";
  if (/componente|juego|combo|incluye|\bset\b|compone/.test(t)) return "componentes";
  if (/codigo|\bsku\b|nombre|duplicad|repetid/.test(t)) return "codigo";
  if (/medida|capacidad|dimension|\bcm\b|personas|tamano/.test(t)) return "medidas";
  if (/cantidad|stock|unidades/.test(t)) return "cantidad";
  return "otro";
}

const problem = (nivel: ImportProblem["nivel"], tipo: ProblemKind, codigo: string | null, fila: number | null, mensaje: string): ImportProblem => ({
  nivel,
  tipo,
  codigo,
  fila,
  mensaje,
});

// ── Normalización ───────────────────────────────────────────────────────────

const text = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  if (!clean || clean.toLowerCase() === "null") return null;
  return clean.slice(0, max);
};

/** Entero en guaraníes desde número o texto («660000», «660.000»). `false` = inválido. */
export function parsePygAmount(raw: unknown): number | null | false {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const clean = raw.trim().replace(/^gs\.?\s*/i, "");
    if (!clean || clean.toLowerCase() === "null") return null;
    if (/^\d{1,3}([.,]\d{3})+$/.test(clean)) return inventoryPriceValue(clean.replace(/[.,]/g, ""));
    return inventoryPriceValue(clean);
  }
  return inventoryPriceValue(raw);
}

function parseWholeNumber(raw: unknown): number | null | false {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "string" ? (raw.trim().toLowerCase() === "null" ? null : /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN) : raw;
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100_000 ? value : false;
}

/** Stock: zero is confirmed empty; null/absent remains unknown. Components stay positive. */
export function parseCatalogQuantity(raw: unknown): number | null | false {
  if (raw === 0 || (typeof raw === "string" && /^0+$/.test(raw.trim()))) return 0;
  return parseWholeNumber(raw);
}

/** Cantidad de unidades en un estado: entero ≥ 0. `null` = campo ausente; `false` = inválido. */
export function parseStateCount(raw: unknown): number | null | false {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!clean || clean.toLowerCase() === "null") return null;
    return /^\d{1,6}$/.test(clean) ? Number(clean) : false;
  }
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 100_000 ? raw : false;
}

/**
 * «Precio por días»: acepta `[{desde_dias, modo: "dia"|"total", precio}]` (JSON) o el texto de planilla
 * «3:dia:90000; 5:total:300000». Un escalón «dia» es precio por día; «total» es el total del período.
 */
function parseTierEntries(raw: unknown): { ok: true; list: PriceTier[] } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, list: [] };
  let entries: unknown[];
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!clean || clean.toLowerCase() === "null") return { ok: true, list: [] };
    entries = clean.split(/[;\n]+/).flatMap((part) => {
      const piece = part.trim();
      if (!piece) return [];
      const [desde, modo, precio] = piece.split(":").map((value) => value.trim());
      return [{ desde_dias: desde, modo, precio }];
    });
  } else if (Array.isArray(raw)) {
    entries = raw;
  } else {
    return { ok: false, error: "«precios_dias» debe ser una lista." };
  }
  if (entries.length > PRICE_TIER_MAX_ROWS) return { ok: false, error: `«precios_dias» admite hasta ${PRICE_TIER_MAX_ROWS} escalones.` };
  const seen = new Set<number>();
  const list: PriceTier[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "Un escalón de «precios_dias» no tiene el formato {desde_dias, modo, precio}." };
    const row = entry as Record<string, unknown>;
    const desde = parseWholeNumber(row.desde_dias);
    const modo = String(row.modo ?? "").trim().toLowerCase().replace("í", "i");
    const precio = parsePygAmount(row.precio);
    if (desde === false || desde === null || desde > PRICE_TIER_MAX_DAYS) return { ok: false, error: `«desde_dias» debe ser un entero de 1 a ${PRICE_TIER_MAX_DAYS}.` };
    if (modo !== "dia" && modo !== "total") return { ok: false, error: "«modo» debe ser «dia» (precio por día) o «total» (total del período)." };
    if (precio === false || precio === null || precio < 1 || precio > PRICE_TIER_PRICE_MAX) return { ok: false, error: "«precio» del escalón debe ser un entero en guaraníes mayor a 0." };
    if (seen.has(desde)) return { ok: false, error: `Hay dos escalones desde ${desde} días.` };
    seen.add(desde);
    list.push({ fromDays: desde, mode: modo === "total" ? "TOTAL" : "PER_DAY", price: precio });
  }
  return { ok: true, list: sortTiers(list) };
}

/** Acepta `[{codigo,cantidad}]` o el texto de planilla «743x2; 811x4». */
function parseComponents(raw: unknown): { ok: true; list: CatalogComponent[] } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, list: [] };
  let entries: unknown[];
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!clean || clean.toLowerCase() === "null") return { ok: true, list: [] };
    entries = clean.split(/[;\n]+/).flatMap((part) => {
      const piece = part.trim();
      if (!piece) return [];
      const match = piece.match(/^(.+?)\s*[x×*]\s*(\d+)$/i);
      return [match ? { codigo: match[1].trim(), cantidad: Number(match[2]) } : { codigo: piece, cantidad: 1 }];
    });
  } else if (Array.isArray(raw)) {
    entries = raw;
  } else {
    return { ok: false, error: "«componentes» debe ser una lista." };
  }
  if (entries.length > CATALOG_LIMITS.components) return { ok: false, error: `Un juego no puede tener más de ${CATALOG_LIMITS.components} componentes.` };
  const merged = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "Un componente no tiene el formato {codigo, cantidad}." };
    const { codigo, cantidad } = entry as Record<string, unknown>;
    const code = normalizeInventorySku(codigo === null || codigo === undefined ? "" : String(codigo));
    const qty = parseWholeNumber(cantidad ?? 1);
    if (!code || qty === false || qty === null) return { ok: false, error: `El componente «${code || "sin código"}» necesita una cantidad entera de 1 o más.` };
    merged.set(code, (merged.get(code) ?? 0) + qty);
  }
  return { ok: true, list: [...merged].map(([codigo, cantidad]) => ({ codigo, cantidad })) };
}

export type NormalizeResult = { doc: CatalogDoc; problems: ImportProblem[] };

/**
 * Sección opcional `categorias: [{ nombre, foto, orden }]`. Nunca bloquea la importación: una
 * entrada inservible se descarta con un aviso. El nombre se normaliza como el de un producto
 * («Categoría / Subcategoría» se separa); repetidas (misma clave) se ignoran.
 */
export function normalizeCategories(raw: unknown, problems: ImportProblem[]): CatalogCategory[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push(problem("aviso", "categoria-invalida", null, null, "La sección «categorias» no es una lista: se ignora."));
    return [];
  }
  if (raw.length > CATALOG_LIMITS.categories) {
    problems.push(problem("aviso", "categoria-invalida", null, null, `Hay ${raw.length} categorías: el máximo es ${CATALOG_LIMITS.categories}; se ignora la sección.`));
    return [];
  }
  const seen = new Set<string>();
  const list: CatalogCategory[] = [];
  raw.forEach((entry, index) => {
    const fila = index + 1;
    const row = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    const nombre = row ? text(row.nombre, 120) : null;
    if (!row || !nombre) {
      problems.push(problem("aviso", "categoria-invalida", null, fila, `Categoría ${fila}: falta el «nombre»; se ignora.`));
      return;
    }
    const path = parseCategoryInput(nombre, "");
    if (!path.parent) {
      problems.push(problem("aviso", "categoria-invalida", null, fila, `Categoría «${nombre}»: el nombre no es válido; se ignora.`));
      return;
    }
    const key = categoryPathKey(path.parent, path.child);
    if (seen.has(key)) {
      problems.push(problem("aviso", "categoria-repetida", null, fila, `Categoría «${nombre}» repetida en la lista: se usa la primera.`));
      return;
    }
    seen.add(key);
    let orden: number | null = null;
    if (row.orden !== undefined && row.orden !== null && row.orden !== "") {
      const value = Number(row.orden);
      if (Number.isInteger(value) && value >= 0 && value <= 9999) orden = value;
      else problems.push(problem("aviso", "categoria-invalida", null, fila, `Categoría «${nombre}»: «orden» tiene que ser un entero de 0 a 9999; se ignora el orden.`));
    }
    const foto = text(row.foto, FIELD_LIMITS.image);
    list.push({ categoria: path.parent, subcategoria: path.child, foto, orden, fila });
  });
  return list;
}

/** Lista de textos desde un arreglo o un texto separado por comas, punto y coma o barra vertical. `undefined`/`null` = el campo no vino. */
function textList(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;|\n]/) : [];
  return list.flatMap((entry) => {
    const value = typeof entry === "string" || typeof entry === "number" ? text(entry, 160) : null;
    return value ? [value] : [];
  });
}

const simpleFileName = (name: string) => !/[\\/]|\.\./.test(name);

/**
 * Sección opcional `colecciones: [{ nombre, descripcion, foto, orden }]`. Nunca bloquea la importación: una entrada
 * inservible se descarta con un aviso. La clave de comparación es el slug (sin tildes ni mayúsculas); repetidas se ignoran.
 */
export function normalizeCollections(raw: unknown, problems: ImportProblem[]): CatalogCollection[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push(problem("aviso", "coleccion-invalida", null, null, "La sección «colecciones» no es una lista: se ignora."));
    return [];
  }
  if (raw.length > COLLECTIONS_MAX) {
    problems.push(problem("aviso", "coleccion-invalida", null, null, `Hay ${raw.length} colecciones: el máximo es ${COLLECTIONS_MAX}; se ignora la sección.`));
    return [];
  }
  const seen = new Set<string>();
  const list: CatalogCollection[] = [];
  raw.forEach((entry, index) => {
    const fila = index + 1;
    const row = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    const nombre = row ? text(row.nombre, COLLECTION_NAME_MAX + 1) : null;
    if (!row || !nombre || nombre.length > COLLECTION_NAME_MAX || !collectionSlug(nombre)) {
      problems.push(problem("aviso", "coleccion-invalida", null, fila, `Colección ${fila}: falta un «nombre» válido (hasta ${COLLECTION_NAME_MAX} caracteres, con letras o números); se ignora.`));
      return;
    }
    const key = collectionSlug(nombre);
    if (seen.has(key)) {
      problems.push(problem("aviso", "coleccion-repetida", null, fila, `Colección «${nombre}» repetida en la lista: se usa la primera.`));
      return;
    }
    seen.add(key);
    let orden: number | null = null;
    if (row.orden !== undefined && row.orden !== null && row.orden !== "") {
      const value = Number(row.orden);
      if (Number.isInteger(value) && value >= 0 && value <= COLLECTION_ORDER_MAX) orden = value;
      else problems.push(problem("aviso", "coleccion-invalida", null, fila, `Colección «${nombre}»: «orden» tiene que ser un entero de 0 a ${COLLECTION_ORDER_MAX}; se ignora el orden.`));
    }
    const descripcion = text(row.descripcion, COLLECTION_DESCRIPTION_MAX);
    const fotoRaw = text(row.foto, 160);
    const foto = fotoRaw && simpleFileName(fotoRaw) ? fotoRaw : null;
    if (fotoRaw && !foto) problems.push(problem("aviso", "foto-invalida", null, fila, `Colección «${nombre}»: el nombre de foto «${fotoRaw}» no es un archivo simple; se ignora.`));
    list.push({ nombre: nombre.replace(/\s+/g, " "), descripcion, foto, orden, fila });
  });
  return list;
}

/** Convierte un producto crudo; `null` cuando no sirve (y deja el error). */
function normalizeProduct(raw: unknown, index: number, problems: ImportProblem[]): CatalogProduct | null {
  const fila = index + 1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(problem("error", "fila-invalida", null, fila, `El producto #${fila} no es un objeto válido.`));
    return null;
  }
  const row = raw as Record<string, unknown>;
  const codigo = normalizeInventorySku(row.codigo === null || row.codigo === undefined ? "" : String(row.codigo));
  if (!codigo || !inventorySkuValid(codigo)) {
    problems.push(problem("error", "codigo-invalido", codigo || null, fila, `Producto #${fila}: código inválido. ${FIELD_MESSAGES.sku}`));
    return null;
  }
  const nombre = normalizePersonName(row.nombre === null || row.nombre === undefined ? "" : String(row.nombre));
  if (!personNameValid(nombre)) {
    problems.push(problem("error", "nombre-invalido", codigo, fila, `Código ${codigo}: ${FIELD_MESSAGES.name}`));
    return null;
  }
  const tipoRaw = text(row.tipo, 20)?.toLowerCase() ?? null;
  if (tipoRaw !== null && tipoRaw !== "juego" && tipoRaw !== "unidad") {
    problems.push(problem("error", "tipo-invalido", codigo, fila, `Código ${codigo}: «tipo» debe ser «juego» o «unidad».`));
    return null;
  }
  const cobroRaw = text(row.cobro, 20)?.toLowerCase().replace("í", "i") ?? "dia";
  if (cobroRaw !== "evento" && cobroRaw !== "dia") {
    problems.push(problem("error", "cobro-invalido", codigo, fila, `Código ${codigo}: «cobro» debe ser «evento» o «dia».`));
    return null;
  }
  const precio = parsePygAmount(row.precio);
  if (precio === false) {
    problems.push(problem("error", "precio-invalido", codigo, fila, `Código ${codigo}: ${FIELD_MESSAGES.price}`));
    return null;
  }
  const preciosDias = parseTierEntries(row.precios_dias);
  if (!preciosDias.ok) {
    problems.push(problem("error", "precios-dias-invalido", codigo, fila, `Código ${codigo}: ${preciosDias.error}`));
    return null;
  }
  const cantidad = parseCatalogQuantity(row.cantidad);
  if (cantidad === false) {
    problems.push(problem("error", "cantidad-invalida", codigo, fila, `Código ${codigo}: la cantidad debe ser un entero de 0 o más (o null para pendiente de conteo).`));
    return null;
  }
  const estados = {
    en_mantenimiento: parseStateCount(row.en_mantenimiento),
    danadas: parseStateCount(row.danadas ?? row["dañadas"]),
    perdidas: parseStateCount(row.perdidas),
  };
  for (const [campo, value] of Object.entries(estados)) {
    if (value === false) {
      problems.push(problem("error", "estado-invalido", codigo, fila, `Código ${codigo}: «${campo}» debe ser un entero de 0 o más (o vacío para no tocar el estado).`));
      return null;
    }
  }
  const componentes = parseComponents(row.componentes);
  if (!componentes.ok) {
    problems.push(problem("error", "componente-invalido", codigo, fila, `Código ${codigo}: ${componentes.error}`));
    return null;
  }
  const fotoRaw = text(row.foto, 160);
  if (fotoRaw && /[\\/]|\.\./.test(fotoRaw)) {
    problems.push(problem("aviso", "foto-invalida", codigo, fila, `Código ${codigo}: el nombre de foto «${fotoRaw}» no es un archivo simple; se ignora.`));
  }
  // Varias fotos: `fotos` además de `foto`. La principal es `foto` (o la primera de `fotos`); el resto son extras, sin repetir.
  let principal: string | null = fotoRaw && simpleFileName(fotoRaw) ? fotoRaw : null;
  let fotos: string[] | null = null;
  const fotosRaw = textList(row.fotos);
  if (fotosRaw !== null) {
    const valid: string[] = [];
    for (const name of fotosRaw) {
      if (!simpleFileName(name)) {
        problems.push(problem("aviso", "foto-invalida", codigo, fila, `Código ${codigo}: el nombre de foto «${name}» no es un archivo simple; se ignora.`));
        continue;
      }
      if (!valid.some((other) => other.toLowerCase() === name.toLowerCase())) valid.push(name);
    }
    if (!principal && valid.length > 0) principal = valid.shift()!;
    fotos = valid.filter((name) => !principal || name.toLowerCase() !== principal.toLowerCase());
    if (fotos.length > CATALOG_LIMITS.extraPhotos) {
      problems.push(problem("aviso", "fotos-exceso", codigo, fila, `Código ${codigo}: trae ${fotos.length + 1} fotos y el máximo es ${CATALOG_LIMITS.extraPhotos + 1} (la principal y ${CATALOG_LIMITS.extraPhotos} más); se usan las primeras.`));
      fotos = fotos.slice(0, CATALOG_LIMITS.extraPhotos);
    }
  }
  // Colecciones y estilos: opcionales; ausente = no se toca, lista = se suman (colecciones) o se reemplazan (estilo).
  const coleccionesRaw = textList(row.colecciones);
  let colecciones: string[] | null = null;
  if (coleccionesRaw !== null) {
    const seenSlugs = new Set<string>();
    colecciones = [];
    for (const name of coleccionesRaw) {
      const slug = collectionSlug(name);
      if (!slug || name.length > COLLECTION_NAME_MAX) {
        problems.push(problem("aviso", "coleccion-invalida", codigo, fila, `Código ${codigo}: la colección «${name}» no es un nombre válido; se ignora.`));
        continue;
      }
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      colecciones.push(name.replace(/\s+/g, " "));
    }
  }
  const estiloRaw = textList(row.estilo);
  let estilo: string[] | null = null;
  if (estiloRaw !== null) {
    const parsed = parseTags(estiloRaw);
    estilo = parsed.tags;
    if (parsed.ignored.length > 0) problems.push(problem("aviso", "estilo-invalido", codigo, fila, `Código ${codigo}: estos estilos no entran (máximo ${TAGS_MAX}, hasta 24 caracteres cada uno): ${parsed.ignored.join(", ")}.`));
  }
  // Categoría y subcategoría: por separado o en una sola columna con «/», «>» o «›».
  const categoryPath = parseCategoryInput(row.categoria === null || row.categoria === undefined ? "" : String(row.categoria), row.subcategoria === null || row.subcategoria === undefined ? "" : String(row.subcategoria));
  // Depósito (código) y ubicación: opcionales; un valor mal escrito avisa y se ignora, nunca se inventa.
  const depositoRaw = text(row.deposito, 20);
  let deposito: string | null = null;
  if (depositoRaw) {
    const code = normalizeWarehouseCode(depositoRaw);
    if (warehouseCodeValid(depositoRaw)) deposito = code;
    else problems.push(problem("aviso", "deposito-invalido", codigo, fila, `Código ${codigo}: ${FIELD_MESSAGES.warehouseCode} Se ignora «${depositoRaw}».`));
  }
  const ubicacionRaw = text(row.ubicacion, 40);
  let ubicacion: string | null = null;
  if (ubicacionRaw) {
    const normalized = readInventoryLocation(ubicacionRaw, deposito);
    if (normalized === false) problems.push(problem("aviso", "ubicacion-invalida", codigo, fila, `Código ${codigo}: ${FIELD_MESSAGES.location} Se ignora «${ubicacionRaw}».`));
    else ubicacion = normalized;
  }
  const pagina = parseWholeNumber(row.pagina);
  const dudas = text(row.dudas, 500);
  if (dudas) problems.push({ ...problem("aviso", "duda", codigo, fila, `${nombre}: ${dudas}`), motivo: dudaMotivo(dudas) });
  return {
    codigo,
    nombre,
    categoria: categoryPath.parent,
    subcategoria: categoryPath.child,
    deposito,
    ubicacion,
    tipo: tipoRaw as CatalogProduct["tipo"],
    precio,
    cobro: cobroRaw,
    preciosDias: preciosDias.list,
    cantidad,
    enMantenimiento: estados.en_mantenimiento as number | null,
    danadas: estados.danadas as number | null,
    perdidas: estados.perdidas as number | null,
    medidas: text(row.medidas, 120),
    capacidad: text(row.capacidad, 120),
    descripcion: text(row.descripcion, 2000),
    componentes: componentes.list,
    foto: principal,
    fotos,
    colecciones,
    estilo,
    pagina: pagina === false ? null : pagina,
    dudas,
    fila,
  };
}

/**
 * Productos crudos (JSON, filas de planilla o salida de la IA) → catálogo
 * normalizado. Los productos inservibles se descartan con su error; nunca se
 * inventa un dato.
 */
export function normalizeCatalog(raw: unknown): { ok: true; value: NormalizeResult } | { ok: false; error: string } {
  const source = Array.isArray(raw) ? { productos: raw } : raw;
  if (!source || typeof source !== "object") return { ok: false, error: "El archivo no tiene el formato esperado: falta la lista «productos»." };
  const head = source as Record<string, unknown>;
  if (!Array.isArray(head.productos)) return { ok: false, error: "El archivo no tiene el formato esperado: falta la lista «productos»." };
  if (head.productos.length === 0) return { ok: false, error: "La lista «productos» está vacía." };
  if (head.productos.length > CATALOG_LIMITS.products) {
    return { ok: false, error: `Hay ${head.productos.length} productos: el máximo por importación es ${CATALOG_LIMITS.products}. Dividí el archivo.` };
  }
  const problems: ImportProblem[] = [];
  const moneda = (text(head.moneda, 8) ?? "PYG").toUpperCase();
  if (moneda !== "PYG") {
    return { ok: false, error: `La moneda del catálogo es ${moneda}: LedBox solo importa precios en guaraníes (PYG).` };
  }
  const productos: CatalogProduct[] = [];
  head.productos.forEach((entry, index) => {
    const product = normalizeProduct(entry, index, problems);
    if (product) productos.push(product);
  });
  const categorias = normalizeCategories(head.categorias, problems);
  const colecciones = normalizeCollections(head.colecciones, problems);
  return { ok: true, value: { doc: { empresa: text(head.empresa, FIELD_LIMITS.company), moneda, productos, categorias, colecciones }, problems } };
}

/** Parsea el texto de `catalogo.json` (con el tope de 2 MB). */
export function parseCatalogJson(textContent: string): { ok: true; value: NormalizeResult } | { ok: false; error: string } {
  if (new TextEncoder().encode(textContent).length > CATALOG_LIMITS.jsonBytes) {
    return { ok: false, error: "El JSON supera los 2 MB." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textContent.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "El archivo no es un JSON válido." };
  }
  return normalizeCatalog(raw);
}

// ── Fotos ───────────────────────────────────────────────────────────────────

export const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** Clave de comparación de un nombre de foto: sin carpeta y en minúsculas. */
export const photoKey = (name: string): string => name.split(/[\\/]/).pop()!.trim().toLowerCase();

/** Foto del producto dentro del ZIP: la declarada o `<codigo>.<ext>`. */
export function resolvePhoto(product: Pick<CatalogProduct, "codigo" | "foto">, photoNames: ReadonlySet<string>): string | null {
  if (product.foto) {
    const key = photoKey(product.foto);
    if (photoNames.has(key)) return key;
  }
  for (const ext of PHOTO_EXTENSIONS) {
    const key = `${product.codigo.toLowerCase()}.${ext}`;
    if (photoNames.has(key)) return key;
  }
  return null;
}

// ── Descripción pública ─────────────────────────────────────────────────────

/** Capacidad en personas del archivo («10 personas», «8»): entero 1..9999, o `null` si no es un número claro. */
export function parseCapacity(capacidad: string | null | undefined): number | null {
  const match = /^\D*(\d{1,4})\D*$/.exec((capacidad ?? "").trim());
  const n = match ? Number(match[1]) : 0;
  return n >= 1 ? n : null;
}

/** Medidas del archivo en el campo corto del inventario (≤ 60), o `null` si no entran (van a la descripción). */
export function parseDimensions(medidas: string | null | undefined): string | null {
  const value = (medidas ?? "").trim().replace(/\s+/g, " ");
  return value && value.length <= 60 ? value : null;
}

/** Campos propios de la ficha (`capacity`, `dimensions`) que salen de `capacidad` y `medidas`. */
export function catalogSpecs(product: Pick<CatalogProduct, "medidas" | "capacidad">): { capacity: number | null; dimensions: string | null } {
  return { capacity: parseCapacity(product.capacidad), dimensions: parseDimensions(product.medidas) };
}

/**
 * Arma la descripción pública (≤ 600). Las medidas y la capacidad que entran en los campos propios
 * (`dimensions`, `capacity`) NO se repiten acá; solo van si no se pudieron mapear.
 */
export function buildPublicDescription(product: Pick<CatalogProduct, "medidas" | "capacidad" | "descripcion">): { text: string | null; truncated: boolean } {
  const ensureDot = (value: string) => (/[.!?…]$/.test(value) ? value : `${value}.`);
  const specs = catalogSpecs(product);
  const parts = [
    product.medidas && !specs.dimensions ? `Medidas: ${product.medidas}` : null,
    product.capacidad && specs.capacity === null ? `Capacidad: ${product.capacidad}` : null,
    product.descripcion,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return { text: null, truncated: false };
  const joined = parts.map((part) => ensureDot(part.trim())).join(" ");
  const max = FIELD_LIMITS.publicDescription;
  return joined.length > max ? { text: `${joined.slice(0, max - 1).trimEnd()}…`, truncated: true } : { text: joined, truncated: false };
}

// ── Plan / vista previa ─────────────────────────────────────────────────────

/** Lo que ya existe en la empresa para un código (SKU). */
export type ExistingItem = {
  id: string;
  name: string;
  isCombo: boolean;
  inTrash: boolean;
  units: number;
  activeUnits?: number;
  stockCountStatus?: "CONFIRMED" | "PENDING_COUNT";
  /** Juego importado sin piezas (combo incompleto): es un juego aunque todavía no tenga componentes. */
  incompleto?: boolean;
  /** Asignaciones a eventos del producto (cualquier estado): una unidad con reservas no se convierte en juego. */
  reservas?: number;
  /** Unidades con historial (fuera de servicio, retiradas o con incidentes). */
  unidadesConHistorial?: number;
  /** Unidades por estado (las retiradas no cuentan): base para ajustar estados por importación. */
  estados?: UnitStateCounts;
  /** Cantidad comprometida por asignaciones vigentes o futuras (sin devolver). */
  comprometidas?: number;
};

export type UnitStateCounts = { AVAILABLE: number; MAINTENANCE: number; DAMAGED: number; LOST: number };
export type AdjustableState = "MAINTENANCE" | "DAMAGED" | "LOST";
export const ADJUSTABLE_STATES: readonly AdjustableState[] = ["MAINTENANCE", "DAMAGED", "LOST"];
export type UnitStateTargets = Partial<Record<AdjustableState, number>>;

/** Estados pedidos por el archivo (solo los presentes). */
export function stateTargetsOf(product: Pick<CatalogProduct, "enMantenimiento" | "danadas" | "perdidas">): UnitStateTargets {
  const targets: UnitStateTargets = {};
  if (product.enMantenimiento !== null) targets.MAINTENANCE = product.enMantenimiento;
  if (product.danadas !== null) targets.DAMAGED = product.danadas;
  if (product.perdidas !== null) targets.LOST = product.perdidas;
  return targets;
}

export type UnitStatePlan = {
  /** Unidades AVAILABLE que pasan a cada estado. */
  aEstado: Record<AdjustableState, number>;
  /** Unidades de cada estado que vuelven a AVAILABLE. */
  aDisponible: Record<AdjustableState, number>;
  /** Unidades pedidas de más que no se pudieron mover. */
  faltan: number;
  /** Unidades pedidas para pasar a un estado (las que se necesitaban mover). */
  pedidas: number;
};

/**
 * Cálculo puro de cómo llegar a los estados del archivo. Solo se mueven unidades AVAILABLE que no
 * hacen falta para asignaciones vigentes o futuras (`comprometidas`) y las que están en un estado
 * pedido vuelven a AVAILABLE si el archivo trae menos. Las retiradas y las asignadas no se tocan.
 * `nuevas` son las unidades que esta misma importación crea (entran disponibles).
 */
export function planUnitStates(options: { counts: UnitStateCounts; nuevas: number; comprometidas: number; targets: UnitStateTargets }): UnitStatePlan {
  const aEstado = { MAINTENANCE: 0, DAMAGED: 0, LOST: 0 };
  const aDisponible = { MAINTENANCE: 0, DAMAGED: 0, LOST: 0 };
  let available = options.counts.AVAILABLE + options.nuevas;
  for (const state of ADJUSTABLE_STATES) {
    const target = options.targets[state];
    if (target === undefined) continue;
    const back = Math.max(0, options.counts[state] - target);
    aDisponible[state] = back;
    available += back;
  }
  let free = Math.max(0, available - options.comprometidas);
  let faltan = 0;
  let pedidas = 0;
  for (const state of ADJUSTABLE_STATES) {
    const target = options.targets[state];
    if (target === undefined) continue;
    const need = Math.max(0, target - options.counts[state]);
    const give = Math.min(need, free);
    free -= give;
    aEstado[state] = give;
    pedidas += need;
    faltan += need - give;
  }
  return { aEstado, aDisponible, faltan, pedidas };
}

export type PlannedProduct = {
  stockCountStatus: "CONFIRMED" | "PENDING_COUNT";
  countBefore: number | null;
  countAfter: number | null;
  product: CatalogProduct;
  accion: "crear" | "actualizar" | "omitir";
  /** Se carga como juego (combo): con piezas, o incompleto si el archivo no las trae. */
  esCombo: boolean;
  /** Juego sin piezas: se importa como juego incompleto (no reservable, sin stock propio). */
  incompleto: boolean;
  /** Reimportación: la unidad existente pasa a juego (sin reservas ni unidades con historial). */
  convertir: boolean;
  /** Nombre (clave) de la foto dentro del ZIP, si se encontró. */
  foto: string | null;
  /** Fotos extra encontradas en el ZIP, en orden; `null` = el archivo no trae `fotos` (no se tocan las que ya tiene). */
  fotosExtra: string[] | null;
  publicDescription: string | null;
  /** Unidades a tener (solo unidades): `cantidad` o 1. */
  unidades: number;
  existingId: string | null;
  /** Ajuste de estados de unidad (solo unidades con algún campo de estado en el archivo). */
  estados: UnitStatePlan | null;
};

export type CatalogSummary = {
  total: number;
  crear: number;
  actualizar: number;
  omitidos: number;
  juegos: number;
  /** Juegos que quedan incompletos (sin piezas). */
  incompletos: number;
  /** Unidades existentes que se convierten en juego. */
  convertidos: number;
  /** Unidades que pasan a mantenimiento, dañadas, perdidas, y las que vuelven a disponible. */
  estadosMantenimiento: number;
  estadosDanadas: number;
  estadosPerdidas: number;
  estadosDisponibles: number;
  fotos: number;
  /** Fotos de categoría encontradas en el ZIP. */
  fotosCategoria: number;
  /** Fotos extra de productos encontradas en el ZIP. */
  fotosExtra: number;
  /** Colecciones distintas (declaradas o usadas por algún producto) y fotos de colección encontradas. */
  colecciones: number;
  fotosColeccion: number;
  /** Productos con estilos para filtrar. */
  conEstilo: number;
  errores: number;
  avisos: number;
};

/** Categoría del archivo ya cruzada con el ZIP: `foto` es la clave de la foto encontrada. */
export type PlannedCategory = { category: CatalogCategory; foto: string | null };

/** Colección del archivo (declarada o inferida de los productos) ya cruzada con el ZIP. */
export type PlannedCollection = { nombre: string; descripcion: string | null; orden: number | null; foto: string | null; declarada: boolean };

export type CatalogPlan = { items: PlannedProduct[]; categories: PlannedCategory[]; collections: PlannedCollection[]; problems: ImportProblem[]; summary: CatalogSummary };

/**
 * Plan puro: decide qué se crea, qué se actualiza y qué se omite, y junta los
 * problemas. `existing` trae lo que ya hay en la empresa para los códigos del
 * archivo y los de sus componentes; `photoNames` son las fotos del ZIP (o
 * `null` si no se subió ZIP).
 */
export function planCatalog(options: {
  /** CREATE_ONLY conserva enteros los productos existentes; ausencia = contrato anterior. */
  importMode?: CatalogImportMode;
  products: ReadonlyArray<CatalogProduct>;
  parseProblems?: ReadonlyArray<ImportProblem>;
  existing: ReadonlyMap<string, ExistingItem>;
  photoNames: ReadonlySet<string> | null;
  photoProblems?: ReadonlyArray<ImportProblem>;
  /** Códigos de los depósitos activos de la empresa; `null` = no se verifica. */
  warehouseCodes?: ReadonlySet<string> | null;
  /** Sección opcional `categorias` del archivo. */
  categories?: ReadonlyArray<CatalogCategory>;
  /** Sección opcional `colecciones` del archivo. */
  collections?: ReadonlyArray<CatalogCollection>;
}): CatalogPlan {
  const problems: ImportProblem[] = [...(options.parseProblems ?? []), ...(options.photoProblems ?? [])];
  const seen = new Map<string, CatalogProduct>();
  const unique: CatalogProduct[] = [];
  for (const product of options.products) {
    const first = seen.get(product.codigo);
    if (first) {
      problems.push(problem("error", "codigo-repetido", product.codigo, product.fila, `Código ${product.codigo} repetido (filas ${first.fila} y ${product.fila}): se usa la primera y se omite la repetida.`));
      continue;
    }
    seen.set(product.codigo, product);
    unique.push(product);
  }
  const inFile = (code: string) => seen.get(code);
  const hasComponents = (product: CatalogProduct) => product.componentes.length > 0;
  // Un juego es todo lo que trae piezas o está declarado «juego»; sin piezas queda incompleto.
  const isGameInFile = (product: CatalogProduct) => hasComponents(product) || product.tipo === "juego";

  const usedPhotos = new Set<string>();
  const items: PlannedProduct[] = unique.map((product) => {
    const existing = options.existing.get(product.codigo) ?? null;
    const existingIsGame = Boolean(existing && (existing.isCombo || existing.incompleto));
    // «juego» sin piezas sobre una unidad que ya existe no la convierte: se conserva como unidad.
    const esCombo = isGameInFile(product) && (existing === null || existingIsGame || hasComponents(product));
    // Un juego que ya tiene piezas y el archivo no las repite conserva las suyas (no queda incompleto).
    const incompleto = esCombo && !hasComponents(product) && !existing?.isCombo;
    const base: PlannedProduct = {
      product,
      stockCountStatus: esCombo ? "CONFIRMED" : product.cantidad === null ? existing?.stockCountStatus ?? (existing ? "CONFIRMED" : "PENDING_COUNT") : "CONFIRMED",
      countBefore: existing && existing.stockCountStatus !== "PENDING_COUNT" ? existing.activeUnits ?? existing.units : null,
      countAfter: esCombo ? null : product.cantidad === null ? existing ? existing.stockCountStatus === "PENDING_COUNT" ? null : existing.activeUnits ?? existing.units : null : Math.max(existing?.activeUnits ?? existing?.units ?? 0, product.cantidad),
      accion: existing ? "actualizar" : "crear",
      esCombo,
      incompleto,
      convertir: false,
      foto: null,
      fotosExtra: null,
      publicDescription: null,
      unidades: esCombo ? 0 : product.cantidad ?? 0,
      existingId: existing?.id ?? null,
      estados: null,
    };
    const errors: ImportProblem[] = [];
    if (existing?.stockCountStatus === "PENDING_COUNT" && !esCombo && product.cantidad !== null && product.cantidad < (existing.activeUnits ?? existing.units)) {
      problems.push(problem("error", "cantidad-invalida", product.codigo, product.fila, `${product.nombre}: el conteo es menor que las unidades registradas. Revisá sus estados o retiros antes de confirmar; no se elimina ninguna unidad.`));
      return { ...base, accion: "omitir", stockCountStatus: "PENDING_COUNT", countAfter: null };
    }

    if (existing && options.importMode === "CREATE_ONLY") {
      problems.push(problem("aviso", "existente-conservado", product.codigo, product.fila, `${product.nombre}: el código ya existe; se conserva sin modificar stock, tarifas, datos ni fotos.`));
      const count = existing.stockCountStatus === "PENDING_COUNT" || existingIsGame ? null : existing.activeUnits ?? existing.units;
      return { ...base, accion: "omitir", esCombo: existingIsGame, incompleto: Boolean(existing.incompleto), stockCountStatus: existing.stockCountStatus ?? "CONFIRMED", countBefore: count, countAfter: count };
    }

    if (product.tipo === "juego" && !hasComponents(product)) {
      problems.push(
        problem(
          "aviso",
          "juego-sin-componentes",
          product.codigo,
          product.fila,
          esCombo
            ? `${product.nombre}: figura como juego pero no trae componentes; se importa como juego incompleto: sin stock propio y no se puede reservar hasta que le cargues las piezas (en el editor o reimportando con componentes).`
            : `${product.nombre}: figura como juego sin componentes pero ya existe como unidad; se conserva como unidad. Para convertirlo en juego, reimportalo con sus componentes.`,
        ),
      );
    }
    if (product.tipo === "unidad" && hasComponents(product)) {
      problems.push(problem("aviso", "tipo-corregido", product.codigo, product.fila, `${product.nombre}: figura como unidad pero trae componentes; se carga como juego.`));
    }
    if (hasComponents(product)) {
      for (const component of product.componentes) {
        if (component.codigo === product.codigo) {
          errors.push(problem("error", "juego-anidado", product.codigo, product.fila, `${product.nombre}: un juego no puede contenerse a sí mismo.`));
          continue;
        }
        const inside = options.importMode === "CREATE_ONLY" && options.existing.has(component.codigo) ? undefined : inFile(component.codigo);
        const stored = options.existing.get(component.codigo);
        if (inside) {
          if (isGameInFile(inside)) errors.push(problem("error", "juego-anidado", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} es otro juego; un juego no puede contener juegos.`));
        } else if (stored) {
          if (stored.inTrash) errors.push(problem("error", "componente-inexistente", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} está en la papelera.`));
          else if (stored.isCombo || stored.incompleto) errors.push(problem("error", "juego-anidado", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} ya es un juego en el inventario.`));
        } else {
          errors.push(problem("error", "componente-inexistente", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} no existe en el archivo ni en el inventario.`));
        }
      }
    }
    if (existing?.inTrash) {
      errors.push(problem("error", "sku-papelera", product.codigo, product.fila, `${product.nombre}: hay un producto con el código ${product.codigo} en la papelera; restauralo o eliminalo definitivamente.`));
    } else if (existing && existingIsGame && !esCombo) {
      errors.push(problem("error", "cambia-de-tipo", product.codigo, product.fila, `${product.nombre}: en el inventario es un juego y el archivo lo trae como unidad; no se cambia el tipo por importación.`));
    } else if (existing && !existingIsGame && esCombo) {
      // Unidad → juego: solo sin reservas ni unidades con historial; si no, es un error que frena la fila.
      const reservas = existing.reservas ?? 0;
      const historial = existing.unidadesConHistorial ?? 0;
      if (reservas > 0 || historial > 0) {
        const motivos = [reservas > 0 ? `${reservas} reserva${reservas === 1 ? "" : "s"}` : null, historial > 0 ? `${historial} unidad${historial === 1 ? "" : "es"} con historial (mantenimiento, daños o retiros)` : null].filter(Boolean).join(" y ");
        errors.push(problem("error", "juego-no-convertible", product.codigo, product.fila, `${product.nombre}: hoy es una unidad con ${motivos}; no se puede convertir en juego. Dejalo como unidad o armá un juego nuevo con otro código.`));
      } else {
        base.convertir = true;
        problems.push(problem("aviso", "juego-convertido", product.codigo, product.fila, `${product.nombre}: hoy es una unidad sin reservas ni historial; se convierte en juego y se retiran sus ${existing.units} unidad${existing.units === 1 ? "" : "es"} (un juego no tiene unidades propias).`));
      }
    }
    if (errors.length > 0) {
      problems.push(...errors);
      return { ...base, accion: "omitir" };
    }

    const targets = stateTargetsOf(product);
    if (Object.keys(targets).length > 0) {
      if (esCombo) {
        problems.push(problem("aviso", "estado-ignorado", product.codigo, product.fila, `${product.nombre}: es un juego, no tiene unidades propias; se ignoran «en_mantenimiento», «danadas» y «perdidas».`));
      } else {
        const counts = existing?.estados ?? { AVAILABLE: 0, MAINTENANCE: 0, DAMAGED: 0, LOST: 0 };
        const active = counts.AVAILABLE + counts.MAINTENANCE + counts.DAMAGED + counts.LOST;
        const total = existing ? Math.max(active, product.cantidad ?? active) : product.cantidad ?? 0;
        const requested = (targets.MAINTENANCE ?? 0) + (targets.DAMAGED ?? 0) + (targets.LOST ?? 0);
        if (requested > total) {
          problems.push(problem("error", "estado-excede", product.codigo, product.fila, `${product.nombre}: en mantenimiento + dañadas + perdidas suman ${requested} y el producto tiene ${total} unidad${total === 1 ? "" : "es"}. La suma no puede superar la cantidad.`));
          return { ...base, accion: "omitir" };
        }
        const nuevas = existing ? Math.max(0, (product.cantidad ?? active) - active) : total;
        const estados = planUnitStates({ counts, nuevas, comprometidas: existing?.comprometidas ?? 0, targets });
        base.estados = estados;
        if (estados.faltan > 0) {
          const logradas = estados.pedidas - estados.faltan;
          problems.push(problem("aviso", "estado-incompleto", product.codigo, product.fila, `${product.nombre}: el archivo pide ${estados.pedidas} unidad${estados.pedidas === 1 ? "" : "es"} más en mantenimiento, dañadas o perdidas y solo se pudieron ajustar ${logradas}: el resto está asignado a eventos vigentes o futuros (esas unidades no se tocan).`));
        }
      }
    }
    if (product.deposito && options.warehouseCodes && !options.warehouseCodes.has(product.deposito)) {
      problems.push(problem("aviso", "deposito-inexistente", product.codigo, product.fila, `${product.nombre}: no hay un depósito con el código ${product.deposito}; las unidades nuevas van al depósito principal.`));
    }
    if (!product.precio) {
      problems.push(problem("aviso", "precio-cero", product.codigo, product.fila, `${product.nombre}: precio ${product.precio === 0 ? "0" : "sin dato"}${existing ? "; se conserva el precio actual" : "; queda como «a consultar» (precio 0): la tienda lo muestra como «Consultar» y en un presupuesto la línea queda «falta precio» (no se puede enviar, aprobar ni cobrar hasta cargarlo o marcarla gratis a propósito)"}.`));
    }
    const description = buildPublicDescription(product);
    if (description.truncated) {
      problems.push(problem("aviso", "descripcion-larga", product.codigo, product.fila, `${product.nombre}: la descripción pública supera ${FIELD_LIMITS.publicDescription} caracteres y se recorta.`));
    }
    let foto: string | null = null;
    if (options.photoNames) {
      foto = resolvePhoto(product, options.photoNames);
      if (foto) usedPhotos.add(foto);
      else if (product.foto) problems.push(problem("aviso", "foto-faltante", product.codigo, product.fila, `${product.nombre}: la foto «${product.foto}» no está en el ZIP.`));
    }
    // Fotos extra: solo las que están en el ZIP; la que falta avisa y el resto se importa.
    let fotosExtra: string[] | null = null;
    if (Array.isArray(product.fotos) && options.photoNames) {
      fotosExtra = [];
      for (const name of product.fotos) {
        const key = photoKey(name);
        if (options.photoNames.has(key)) { fotosExtra.push(key); usedPhotos.add(key); }
        else problems.push(problem("aviso", "foto-faltante", product.codigo, product.fila, `${product.nombre}: la foto «${name}» no está en el ZIP.`));
      }
    }
    return { ...base, foto, fotosExtra, publicDescription: description.text };
  });

  // Un juego cuyo componente del archivo fue omitido por error tampoco se puede armar.
  for (let changed = true; changed; ) {
    changed = false;
    for (const item of items) {
      if (item.accion === "omitir" || !item.esCombo || item.product.componentes.length === 0) continue;
      const blocked = item.product.componentes.find((component) => items.find((other) => other.product.codigo === component.codigo)?.accion === "omitir" && !(options.importMode === "CREATE_ONLY" && options.existing.has(component.codigo)));
      if (!blocked) continue;
      item.accion = "omitir";
      item.foto = null;
      item.fotosExtra = null;
      changed = true;
      problems.push(problem("error", "componente-inexistente", item.product.codigo, item.product.fila, `${item.product.nombre}: el componente ${blocked.codigo} tiene errores y no se importa, así que el juego tampoco.`));
    }
  }
  usedPhotos.clear();
  for (const item of items) {
    if (item.accion === "omitir") continue;
    if (item.foto) usedPhotos.add(item.foto);
    for (const name of item.fotosExtra ?? []) usedPhotos.add(name);
  }

  // Fotos de categoría: mismo ZIP, nombre exacto (sin distinguir mayúsculas ni carpeta).
  const categories: PlannedCategory[] = (options.categories ?? []).map((category) => {
    let foto: string | null = null;
    if (category.foto && options.photoNames) {
      const key = photoKey(category.foto);
      if (options.photoNames.has(key)) foto = key;
      else problems.push(problem("aviso", "categoria-foto-faltante", null, category.fila, `Categoría «${category.subcategoria ? `${category.categoria} › ${category.subcategoria}` : category.categoria}»: la foto «${category.foto}» no está en el ZIP.`));
    } else if (category.foto) {
      problems.push(problem("aviso", "categoria-foto-faltante", null, category.fila, `Categoría «${category.categoria}»: declara la foto «${category.foto}» pero no subiste el ZIP.`));
    }
    return { category, foto };
  });
  for (const entry of categories) if (entry.foto) usedPhotos.add(entry.foto);

  // Colecciones: las declaradas más las que nombran los productos que se importan (se crean si faltan).
  const collections: PlannedCollection[] = [];
  const bySlug = new Map<string, PlannedCollection>();
  for (const declared of options.collections ?? []) {
    let foto: string | null = null;
    if (declared.foto && options.photoNames) {
      const key = photoKey(declared.foto);
      if (options.photoNames.has(key)) foto = key;
      else problems.push(problem("aviso", "coleccion-foto-faltante", null, declared.fila, `Colección «${declared.nombre}»: la foto «${declared.foto}» no está en el ZIP.`));
    } else if (declared.foto) {
      problems.push(problem("aviso", "coleccion-foto-faltante", null, declared.fila, `Colección «${declared.nombre}»: declara la foto «${declared.foto}» pero no subiste el ZIP.`));
    }
    const entry: PlannedCollection = { nombre: declared.nombre, descripcion: declared.descripcion, orden: declared.orden, foto, declarada: true };
    bySlug.set(collectionSlug(declared.nombre), entry);
    collections.push(entry);
    if (foto) usedPhotos.add(foto);
  }
  for (const item of items) {
    if (item.accion === "omitir") continue;
    for (const name of item.product.colecciones ?? []) {
      const slug = collectionSlug(name);
      if (bySlug.has(slug)) continue;
      const entry: PlannedCollection = { nombre: name, descripcion: null, orden: null, foto: null, declarada: false };
      bySlug.set(slug, entry);
      collections.push(entry);
    }
  }
  if (collections.length > COLLECTIONS_MAX) {
    problems.push(problem("aviso", "coleccion-invalida", null, null, `El archivo usa ${collections.length} colecciones y el máximo por empresa es ${COLLECTIONS_MAX}; se importan las primeras.`));
    collections.length = COLLECTIONS_MAX;
  }

  if (!options.photoNames) {
    const declared = items.filter((item) => item.accion !== "omitir" && item.product.foto);
    if (declared.length > 0) {
      problems.push(problem("aviso", "foto-sin-zip", null, null, `${declared.length} producto${declared.length === 1 ? "" : "s"} declaran foto pero no subiste el ZIP: se importan sin foto.`));
    }
  } else {
    for (const name of options.photoNames) {
      if (!usedPhotos.has(name)) problems.push(problem("aviso", "foto-sobrante", null, null, `La foto «${name}» del ZIP no corresponde a ningún producto importable.`));
    }
  }

  const live = items.filter((item) => item.accion !== "omitir");
  const summary: CatalogSummary = {
    total: items.length,
    crear: live.filter((item) => item.accion === "crear").length,
    actualizar: live.filter((item) => item.accion === "actualizar").length,
    omitidos: items.length - live.length,
    juegos: live.filter((item) => item.esCombo).length,
    incompletos: live.filter((item) => item.incompleto).length,
    convertidos: live.filter((item) => item.convertir).length,
    estadosMantenimiento: live.reduce((sum, item) => sum + (item.estados?.aEstado.MAINTENANCE ?? 0), 0),
    estadosDanadas: live.reduce((sum, item) => sum + (item.estados?.aEstado.DAMAGED ?? 0), 0),
    estadosPerdidas: live.reduce((sum, item) => sum + (item.estados?.aEstado.LOST ?? 0), 0),
    estadosDisponibles: live.reduce((sum, item) => sum + ADJUSTABLE_STATES.reduce((acc, state) => acc + (item.estados?.aDisponible[state] ?? 0), 0), 0),
    fotos: live.filter((item) => item.foto).length,
    fotosCategoria: categories.filter((entry) => entry.foto).length,
    fotosExtra: live.reduce((sum, item) => sum + (item.fotosExtra?.length ?? 0), 0),
    colecciones: collections.length,
    fotosColeccion: collections.filter((entry) => entry.foto).length,
    conEstilo: live.filter((item) => (item.product.estilo?.length ?? 0) > 0).length,
    errores: problems.filter((entry) => entry.nivel === "error").length,
    avisos: problems.filter((entry) => entry.nivel === "aviso").length,
  };
  return { items, categories, collections, problems, summary };
}

/** Códigos que el plan necesita conocer en la base: los del archivo y los de sus componentes. */
export function codesToLookUp(products: ReadonlyArray<CatalogProduct>): string[] {
  const codes = new Set<string>();
  for (const product of products) {
    codes.add(product.codigo);
    for (const component of product.componentes) codes.add(component.codigo);
  }
  return [...codes];
}

/** Moneda y formato de PYG para mostrar (es-PY). */
export const formatPyg = (value: number): string => `Gs ${value.toLocaleString("es-PY")}`;
