/**
 * Estilos o colores de un producto para filtrar en la tienda («Natural», «Rattan», «Verde»).
 * Reglas puras: las usan el panel, el API y la importación (`"estilo": ["Natural", "Rattan"]`).
 */

export const TAG_MAX_LENGTH = 24;
export const TAGS_MAX = 8;

/** Clave de comparación: sin tildes ni mayúsculas, para no repetir «Rattan» y «rattán». */
export const tagKey = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type ParsedTags = { tags: string[]; ignored: string[] };

/** Limpia una lista (o un texto separado por comas): recorta, quita repetidos y respeta los topes. */
export function parseTags(raw: unknown): ParsedTags {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]/) : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  const ignored: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const value = entry.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = tagKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    if (value.length > TAG_MAX_LENGTH || tags.length >= TAGS_MAX) {
      ignored.push(value);
      continue;
    }
    tags.push(value);
  }
  return { tags, ignored };
}

/** Todos los estilos distintos de un catálogo, en orden alfabético (es). */
export function collectTags(lists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const byKey = new Map<string, string>();
  for (const list of lists) for (const tag of list) if (!byKey.has(tagKey(tag))) byKey.set(tagKey(tag), tag);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"));
}
