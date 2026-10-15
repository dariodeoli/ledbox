/**
 * Inicio de la tienda: orden y visibilidad de las secciones, bloque editorial y fotos de inspiración.
 * Todo es una lista cerrada o un texto con tope; los textos viven en `Organization.appearance.home` y las fotos
 * en `OrganizationCover` (una por «ranura»). Reglas puras: las usan el panel (vista previa), el API, la tienda y los tests.
 */

export const HOME_SECTION_IDS = ["hero", "categorias", "destacados", "colecciones", "catalogo", "como-funciona", "inspiracion", "contacto"] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export const HOME_SECTION_LABEL: Record<HomeSectionId, string> = {
  hero: "Portada (título y fechas)",
  categorias: "Categorías",
  destacados: "Destacados",
  colecciones: "Editorial y colecciones",
  catalogo: "Catálogo",
  "como-funciona": "Cómo funciona",
  inspiracion: "Inspiración",
  contacto: "Contacto y entrega",
};

/** El catálogo es la tienda misma: se puede mover pero no ocultar. */
export const HOME_LOCKED: readonly HomeSectionId[] = ["catalogo"];

export const DEFAULT_HOME_ORDER: readonly HomeSectionId[] = HOME_SECTION_IDS;

export const HOME_LIMITS = { eyebrow: 40, title: 80, text: 400, cta: 32, caption: 80, inspirationTitle: 60 } as const;
export const INSPIRATION_SLOTS = 3;

export const HOME_PHOTO_SLOTS = ["editorial", "inspiracion-1", "inspiracion-2", "inspiracion-3"] as const;
export type HomePhotoSlot = (typeof HOME_PHOTO_SLOTS)[number];
export const isHomePhotoSlot = (value: unknown): value is HomePhotoSlot => typeof value === "string" && (HOME_PHOTO_SLOTS as readonly string[]).includes(value);
export const HOME_PHOTO_LABEL: Record<HomePhotoSlot, string> = {
  editorial: "Foto del bloque editorial",
  "inspiracion-1": "Inspiración 1",
  "inspiracion-2": "Inspiración 2",
  "inspiracion-3": "Inspiración 3",
};
/** Proporción y ancho de salida: 4:5, a 1200 px de ancho como máximo. */
export const HOME_PHOTO_WIDTH = 1200;

export type HomeEditorial = { eyebrow: string; title: string; text: string; cta: string };
export type HomeInspiration = { title: string; captions: string[] };
export const CATEGORY_LAYOUTS = ["cards", "accordion"] as const;
export type CategoryLayout = (typeof CATEGORY_LAYOUTS)[number];
export const isCategoryLayout = (value: unknown): value is CategoryLayout => typeof value === "string" && (CATEGORY_LAYOUTS as readonly string[]).includes(value);
export type HomeConfig = { order: HomeSectionId[]; hidden: HomeSectionId[]; categoryLayout: CategoryLayout; editorial: HomeEditorial; inspiration: HomeInspiration };

export const DEFAULT_HOME: HomeConfig = {
  order: [...DEFAULT_HOME_ORDER],
  hidden: [],
  categoryLayout: "cards",
  editorial: { eyebrow: "", title: "", text: "", cta: "" },
  inspiration: { title: "", captions: ["", "", ""] },
};

export const isHomeSection = (value: unknown): value is HomeSectionId => typeof value === "string" && (HOME_SECTION_IDS as readonly string[]).includes(value);

/** Orden válido: ids conocidos sin repetir y, al final, los que faltaban (en su orden de siempre). */
export function normalizeOrder(raw: unknown): HomeSectionId[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<HomeSectionId>();
  const order: HomeSectionId[] = [];
  for (const id of list) if (isHomeSection(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  for (const id of DEFAULT_HOME_ORDER) if (!seen.has(id)) order.push(id);
  return order;
}

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim();
};

/** Valida lo que manda el panel; lo ausente mantiene `current`. */
export function parseHome(body: unknown, current: HomeConfig = DEFAULT_HOME): { ok: true; home: HomeConfig } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Los módulos de la tienda deben ser un objeto válido." };
  const input = body as Record<string, unknown>;
  const next: HomeConfig = { order: [...current.order], hidden: [...current.hidden], categoryLayout: current.categoryLayout ?? "cards", editorial: { ...current.editorial }, inspiration: { title: current.inspiration.title, captions: [...current.inspiration.captions] } };
  if (input.categoryLayout !== undefined) {
    if (!isCategoryLayout(input.categoryLayout)) return { ok: false, error: "Elegí Tarjetas o Desplegables para las categorías." };
    next.categoryLayout = input.categoryLayout;
  }
  if (input.order !== undefined) {
    if (!Array.isArray(input.order) || input.order.some((id) => !isHomeSection(id))) return { ok: false, error: "El orden de las secciones del inicio no es válido." };
    next.order = normalizeOrder(input.order);
  }
  if (input.hidden !== undefined) {
    if (!Array.isArray(input.hidden) || input.hidden.some((id) => !isHomeSection(id))) return { ok: false, error: "La lista de secciones ocultas no es válida." };
    next.hidden = [...new Set(input.hidden as HomeSectionId[])].filter((id) => !HOME_LOCKED.includes(id));
  }
  if (input.editorial !== undefined) {
    const raw = input.editorial && typeof input.editorial === "object" && !Array.isArray(input.editorial) ? (input.editorial as Record<string, unknown>) : null;
    if (!raw) return { ok: false, error: "El bloque editorial no es válido." };
    for (const key of ["eyebrow", "title", "text", "cta"] as const) {
      if (raw[key] === undefined) continue;
      const value = clean(raw[key], HOME_LIMITS[key]);
      if (value === null) return { ok: false, error: "El bloque editorial lleva solo texto." };
      if (value.length > HOME_LIMITS[key]) return { ok: false, error: `En el bloque editorial, «${key === "eyebrow" ? "rótulo" : key === "title" ? "título" : key === "text" ? "texto" : "botón"}» no puede superar los ${HOME_LIMITS[key]} caracteres.` };
      next.editorial[key] = value;
    }
  }
  if (input.inspiration !== undefined) {
    const raw = input.inspiration && typeof input.inspiration === "object" && !Array.isArray(input.inspiration) ? (input.inspiration as Record<string, unknown>) : null;
    if (!raw) return { ok: false, error: "La sección de inspiración no es válida." };
    if (raw.title !== undefined) {
      const value = clean(raw.title, HOME_LIMITS.inspirationTitle);
      if (value === null || value.length > HOME_LIMITS.inspirationTitle) return { ok: false, error: `El título de inspiración no puede superar los ${HOME_LIMITS.inspirationTitle} caracteres.` };
      next.inspiration.title = value;
    }
    if (raw.captions !== undefined) {
      if (!Array.isArray(raw.captions) || raw.captions.length > INSPIRATION_SLOTS) return { ok: false, error: `La inspiración lleva hasta ${INSPIRATION_SLOTS} textos.` };
      const captions = [...next.inspiration.captions];
      for (let index = 0; index < INSPIRATION_SLOTS; index += 1) {
        const entry = (raw.captions as unknown[])[index];
        if (entry === undefined) continue;
        const value = clean(entry, HOME_LIMITS.caption);
        if (value === null || value.length > HOME_LIMITS.caption) return { ok: false, error: `Cada texto de inspiración puede tener hasta ${HOME_LIMITS.caption} caracteres.` };
        captions[index] = value;
      }
      next.inspiration.captions = captions;
    }
  }
  return { ok: true, home: next };
}

/** Lee lo guardado tolerando filas viejas o rotas: nunca lanza y devuelve siempre un inicio completo. */
export function readHome(stored: unknown): HomeConfig {
  const record = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const parsed = parseHome(record);
  if (parsed.ok) return parsed.home;
  let partial: HomeConfig = { order: normalizeOrder(record.order), hidden: [], categoryLayout: "cards", editorial: { ...DEFAULT_HOME.editorial }, inspiration: { title: "", captions: ["", "", ""] } };
  if (Array.isArray(record.hidden)) partial.hidden = [...new Set(record.hidden.filter(isHomeSection))].filter((id) => !HOME_LOCKED.includes(id));
  // Una opción vieja o rota no borra otros módulos válidos de la empresa.
  for (const key of ["categoryLayout", "editorial", "inspiration"] as const) {
    if (record[key] === undefined) continue;
    const field = parseHome({ [key]: record[key] }, partial);
    if (field.ok) partial = field.home;
  }
  return partial;
}

/** Secciones que se dibujan, en orden. */
export function visibleSections(home: HomeConfig): HomeSectionId[] {
  const hidden = new Set(home.hidden);
  return normalizeOrder(home.order).filter((id) => !hidden.has(id) || HOME_LOCKED.includes(id));
}

/** Mueve una sección una posición («Subir»/«Bajar»); en los bordes no hace nada. */
export function moveSection(order: readonly HomeSectionId[], id: HomeSectionId, direction: -1 | 1): HomeSectionId[] {
  const list = normalizeOrder(order);
  const from = list.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}

/** Mueve una sección a una posición exacta (arrastrar y soltar). */
export function moveSectionTo(order: readonly HomeSectionId[], id: HomeSectionId, target: HomeSectionId): HomeSectionId[] {
  const list = normalizeOrder(order);
  const from = list.indexOf(id);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return list;
  list.splice(from, 1);
  list.splice(to, 0, id);
  return list;
}

export const editorialHasContent = (editorial: HomeEditorial): boolean => Boolean(editorial.title || editorial.text);

/** Posición indicada por el borde de destino durante el arrastre (sin mutar la entrada). */
export function moveSectionAtEdge(order: readonly HomeSectionId[], id: HomeSectionId, target: HomeSectionId, edge: "before" | "after"): HomeSectionId[] {
  const list = normalizeOrder(order);
  if (id === target || !list.includes(id) || !list.includes(target)) return list;
  const next = list.filter((value) => value !== id);
  const index = next.indexOf(target) + (edge === "after" ? 1 : 0);
  next.splice(index, 0, id);
  return next;
}
