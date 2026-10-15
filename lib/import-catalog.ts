/**
 * «Importar catálogo»: contrato y reglas puras (sin React, sin base, sin Node).
 *
 * Los tres caminos de entrada (JSON de ChatGPT, planilla .xlsx/.csv e IA de
 * LedBox) terminan en `normalizeCatalog`, y de ahí en `planCatalog`: la misma
 * vista previa, con los mismos problemas, para cualquier origen. Las reglas de
 * campo (nombre, SKU, precio en PYG entero) son las del alta de inventario
 * (`lib/field-rules.ts`); acá no se duplican.
 */

import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
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
  zipInflatedBytes: 320 * 1024 * 1024,
  /** Productos por importación. */
  products: 1000,
  /** Componentes por juego. */
  components: 60,
  /** Llamadas por empresa y ventana (15 min). */
  previewRate: 20,
  applyRate: 10,
} as const;

export type CatalogComponent = { codigo: string; cantidad: number };

export type CatalogProduct = {
  codigo: string;
  nombre: string;
  categoria: string;
  tipo: "juego" | "unidad" | null;
  /** Guaraníes enteros; `null` = sin dato. */
  precio: number | null;
  /** Cómo se cobra: por evento (por defecto) o por día. */
  cobro: "evento" | "dia";
  cantidad: number | null;
  medidas: string | null;
  capacidad: string | null;
  descripcion: string | null;
  componentes: CatalogComponent[];
  foto: string | null;
  pagina: number | null;
  dudas: string | null;
  /** Posición (1-based) en el archivo de origen. */
  fila: number;
};

export type CatalogDoc = { empresa: string | null; moneda: string; productos: CatalogProduct[] };

export type ProblemKind =
  | "codigo-repetido"
  | "codigo-invalido"
  | "nombre-invalido"
  | "tipo-invalido"
  | "cobro-invalido"
  | "precio-invalido"
  | "precio-cero"
  | "cantidad-invalida"
  | "componente-inexistente"
  | "componente-invalido"
  | "juego-anidado"
  | "juego-sin-componentes"
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
  const cantidad = parseWholeNumber(row.cantidad);
  if (cantidad === false) {
    problems.push(problem("error", "cantidad-invalida", codigo, fila, `Código ${codigo}: la cantidad debe ser un entero de 1 o más (o null).`));
    return null;
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
  const pagina = parseWholeNumber(row.pagina);
  const dudas = text(row.dudas, 500);
  if (dudas) problems.push({ ...problem("aviso", "duda", codigo, fila, `${nombre}: ${dudas}`), motivo: dudaMotivo(dudas) });
  return {
    codigo,
    nombre,
    categoria: text(row.categoria, 80) ?? "General",
    tipo: tipoRaw as CatalogProduct["tipo"],
    precio,
    cobro: cobroRaw,
    cantidad,
    medidas: text(row.medidas, 120),
    capacidad: text(row.capacidad, 120),
    descripcion: text(row.descripcion, 2000),
    componentes: componentes.list,
    foto: fotoRaw && !/[\\/]|\.\./.test(fotoRaw) ? fotoRaw : null,
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
  return { ok: true, value: { doc: { empresa: text(head.empresa, FIELD_LIMITS.company), moneda, productos }, problems } };
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

/** Arma la descripción pública con medidas, capacidad y descripción (≤ 600). */
export function buildPublicDescription(product: Pick<CatalogProduct, "medidas" | "capacidad" | "descripcion">): { text: string | null; truncated: boolean } {
  const ensureDot = (value: string) => (/[.!?…]$/.test(value) ? value : `${value}.`);
  const parts = [
    product.medidas ? `Medidas: ${product.medidas}` : null,
    product.capacidad ? `Capacidad: ${product.capacidad}` : null,
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
};

export type PlannedProduct = {
  product: CatalogProduct;
  accion: "crear" | "actualizar" | "omitir";
  esCombo: boolean;
  /** Nombre (clave) de la foto dentro del ZIP, si se encontró. */
  foto: string | null;
  publicDescription: string | null;
  /** Unidades a tener (solo unidades): `cantidad` o 1. */
  unidades: number;
  existingId: string | null;
};

export type CatalogSummary = {
  total: number;
  crear: number;
  actualizar: number;
  omitidos: number;
  juegos: number;
  fotos: number;
  errores: number;
  avisos: number;
};

export type CatalogPlan = { items: PlannedProduct[]; problems: ImportProblem[]; summary: CatalogSummary };

/**
 * Plan puro: decide qué se crea, qué se actualiza y qué se omite, y junta los
 * problemas. `existing` trae lo que ya hay en la empresa para los códigos del
 * archivo y los de sus componentes; `photoNames` son las fotos del ZIP (o
 * `null` si no se subió ZIP).
 */
export function planCatalog(options: {
  products: ReadonlyArray<CatalogProduct>;
  parseProblems?: ReadonlyArray<ImportProblem>;
  existing: ReadonlyMap<string, ExistingItem>;
  photoNames: ReadonlySet<string> | null;
  photoProblems?: ReadonlyArray<ImportProblem>;
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
  const isComboInFile = (product: CatalogProduct) => product.componentes.length > 0;

  const usedPhotos = new Set<string>();
  const items: PlannedProduct[] = unique.map((product) => {
    const existing = options.existing.get(product.codigo) ?? null;
    const esCombo = isComboInFile(product);
    const base: PlannedProduct = {
      product,
      accion: existing ? "actualizar" : "crear",
      esCombo,
      foto: null,
      publicDescription: null,
      unidades: product.cantidad ?? 1,
      existingId: existing?.id ?? null,
    };
    const errors: ImportProblem[] = [];

    if (product.tipo === "juego" && !esCombo) {
      problems.push(problem("aviso", "juego-sin-componentes", product.codigo, product.fila, `${product.nombre}: figura como juego pero no trae componentes; se carga como unidad${product.cantidad ? ` (cantidad ${product.cantidad})` : ""}.`));
    }
    if (product.tipo === "unidad" && esCombo) {
      problems.push(problem("aviso", "tipo-corregido", product.codigo, product.fila, `${product.nombre}: figura como unidad pero trae componentes; se carga como juego.`));
    }
    if (esCombo) {
      for (const component of product.componentes) {
        if (component.codigo === product.codigo) {
          errors.push(problem("error", "juego-anidado", product.codigo, product.fila, `${product.nombre}: un juego no puede contenerse a sí mismo.`));
          continue;
        }
        const inside = inFile(component.codigo);
        const stored = options.existing.get(component.codigo);
        if (inside) {
          if (isComboInFile(inside)) errors.push(problem("error", "juego-anidado", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} es otro juego; un juego no puede contener juegos.`));
        } else if (stored) {
          if (stored.inTrash) errors.push(problem("error", "componente-inexistente", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} está en la papelera.`));
          else if (stored.isCombo) errors.push(problem("error", "juego-anidado", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} ya es un juego en el inventario.`));
        } else {
          errors.push(problem("error", "componente-inexistente", product.codigo, product.fila, `${product.nombre}: el componente ${component.codigo} no existe en el archivo ni en el inventario.`));
        }
      }
    }
    if (existing?.inTrash) {
      errors.push(problem("error", "sku-papelera", product.codigo, product.fila, `${product.nombre}: hay un producto con el código ${product.codigo} en la papelera; restauralo o eliminalo definitivamente.`));
    } else if (existing && existing.isCombo !== esCombo) {
      errors.push(problem("error", "cambia-de-tipo", product.codigo, product.fila, `${product.nombre}: en el inventario ${existing.isCombo ? "es un juego y el archivo lo trae como unidad" : "es una unidad y el archivo lo trae como juego"}; no se cambia el tipo por importación.`));
    }
    if (errors.length > 0) {
      problems.push(...errors);
      return { ...base, accion: "omitir" };
    }

    if (!product.precio) {
      problems.push(problem("aviso", "precio-cero", product.codigo, product.fila, `${product.nombre}: precio ${product.precio === 0 ? "0" : "sin dato"}${existing ? "; se conserva el precio actual" : "; se importa con precio 0 y la tienda lo muestra como «Consultar»"}.`));
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
    return { ...base, foto, publicDescription: description.text };
  });

  // Un juego cuyo componente del archivo fue omitido por error tampoco se puede armar.
  for (let changed = true; changed; ) {
    changed = false;
    for (const item of items) {
      if (item.accion === "omitir" || !item.esCombo) continue;
      const blocked = item.product.componentes.find((component) => items.find((other) => other.product.codigo === component.codigo)?.accion === "omitir");
      if (!blocked) continue;
      item.accion = "omitir";
      item.foto = null;
      changed = true;
      problems.push(problem("error", "componente-inexistente", item.product.codigo, item.product.fila, `${item.product.nombre}: el componente ${blocked.codigo} tiene errores y no se importa, así que el juego tampoco.`));
    }
  }
  usedPhotos.clear();
  for (const item of items) if (item.foto && item.accion !== "omitir") usedPhotos.add(item.foto);

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
    fotos: live.filter((item) => item.foto).length,
    errores: problems.filter((entry) => entry.nivel === "error").length,
    avisos: problems.filter((entry) => entry.nivel === "aviso").length,
  };
  return { items, problems, summary };
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
