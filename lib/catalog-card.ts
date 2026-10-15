import { parseCapacity, parseDimensions } from "@/lib/import-catalog";

/**
 * Datos de la tarjeta de producto de la tienda (solo para MOSTRAR, nunca se escribe en la base).
 *
 * Muchos productos se importaron antes de que existieran los campos `dimensions` y `capacity`: sus medidas y su
 * capacidad quedaron escritas dentro de la descripción pública («Medidas: 40 cm. Capacidad: 10 personas. Texto.»).
 * Cuando falta el campo propio se lo extrae de la descripción con los MISMOS parsers del importador
 * (`parseDimensions`, `parseCapacity`), así la tarjeta muestra lo mismo que mostraría tras reimportar el archivo.
 */

export type CardSpecs = {
  dimensions: string | null;
  capacity: number | null;
  /** Descripción sin los renglones que se mostraron como chips (`null` si no queda nada). */
  description: string | null;
};

type Field = "Medidas" | "Capacidad";

/** Valor de «Medidas: …» / «Capacidad: …»: hasta el fin del renglón o hasta «. » seguido de otra frase (los decimales «1.40» no cortan). */
function fieldPattern(label: Field): RegExp {
  return new RegExp(`(?:^|(?<=[\\s.]))${label}s?\\s*:\\s*(.+?)(?:\\.(?=\\s+[A-ZÁÉÍÓÚÑ¿¡])|\\.?(?=\\s*\\n)|\\.?\\s*$)`, "im");
}

function take(text: string, label: Field): { value: string; rest: string } | null {
  const match = fieldPattern(label).exec(text);
  if (!match) return null;
  return { value: match[1].trim(), rest: `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}` };
}

const tidy = (text: string) => text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/^[\s.]+|\s+$/g, "").trim();

export function cardSpecs(item: { dimensions?: string | null; capacity?: number | null; description?: string | null }): CardSpecs {
  let description = item.description ?? "";
  let dimensions = item.dimensions?.trim() || null;
  let capacity = item.capacity && item.capacity > 0 ? item.capacity : null;
  if (!dimensions) {
    const found = take(description, "Medidas");
    const parsed = found ? parseDimensions(found.value) : null;
    if (found && parsed) { dimensions = parsed; description = found.rest; }
  }
  if (capacity === null) {
    const found = take(description, "Capacidad");
    const parsed = found ? parseCapacity(found.value) : null;
    if (found && parsed !== null) { capacity = parsed; description = found.rest; }
  }
  const cleaned = tidy(description);
  return { dimensions, capacity, description: cleaned || null };
}

/** «10 personas» / «1 persona». */
export const capacityText = (capacity: number) => `${capacity} ${capacity === 1 ? "persona" : "personas"}`;
