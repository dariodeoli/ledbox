/**
 * Marca de un banco para los datos de pago (issue #14) — fuente única.
 *
 * Regla de la app para logos/marcas externas: **registro por nombre → asset del
 * repo (sin hotlinks) → monograma con iniciales y color**. Acá se resuelve en
 * una sola función:
 *
 *  1. Se normaliza el nombre (`bankKey`) y se busca en el registro.
 *  2. Si el registro define `asset`, se usa (`/assets/banks/<clave>.svg`); hoy
 *     ningún banco tiene asset versionado, así que todos caen al monograma.
 *  3. Sin asset, se dibuja el monograma: iniciales + color. El color sale de la
 *     marca cuando el banco está registrado y, si no, de una paleta estable
 *     derivada del nombre (mismo nombre → mismo color, sin depender del orden).
 *
 * Devuelve `null` solo cuando no hay nombre de banco: sin banco no hay marca.
 */

export type BankMark = {
  /** Clave normalizada del banco (ej.: `banco continental`). */
  key: string;
  /** Nombre canónico para mostrar (el del registro, o el tipeado tal cual). */
  label: string;
  /** Iniciales del monograma (1–3 letras). */
  initials: string;
  /** Color de marca o de la paleta estable, en hex. */
  color: string;
  /** Asset del repositorio o `null` mientras no haya asset versionado. */
  asset: string | null;
};

type BankRecord = {
  /** Nombre canónico que se muestra en el portal y en la hoja impresa. */
  label: string;
  /** Color de marca para el monograma. */
  color: string;
  /** Iniciales propias, cuando las del nombre no alcanzan (ej.: BNF). */
  initials?: string;
  /** Asset del repo (`/assets/banks/<clave>.svg`) cuando exista. */
  asset?: string;
};

/** Bancos frecuentes de Paraguay: solo color e iniciales (los assets llegan después). */
const BANK_REGISTRY: Record<string, BankRecord> = {
  "banco continental": { label: "Banco Continental", color: "#0E8A4F" },
  continental: { label: "Banco Continental", color: "#0E8A4F" },
  "banco itau": { label: "Banco Itaú", color: "#EC7000" },
  itau: { label: "Banco Itaú", color: "#EC7000" },
  "itau paraguay": { label: "Banco Itaú Paraguay", color: "#EC7000" },
  "banco ueno": { label: "Ueno Bank", color: "#6D2C91" },
  ueno: { label: "Ueno Bank", color: "#6D2C91" },
  "ueno bank": { label: "Ueno Bank", color: "#6D2C91" },
  "banco atlas": { label: "Banco Atlas", color: "#0B5AA4" },
  atlas: { label: "Banco Atlas", color: "#0B5AA4" },
  "banco familiar": { label: "Banco Familiar", color: "#D6002B" },
  familiar: { label: "Banco Familiar", color: "#D6002B" },
  "banco vision": { label: "Banco Visión", color: "#E4572E" },
  vision: { label: "Banco Visión", color: "#E4572E" },
  "banco sudameris": { label: "Banco Sudameris", color: "#003B71" },
  sudameris: { label: "Banco Sudameris", color: "#003B71" },
  "banco nacional de fomento": { label: "Banco Nacional de Fomento", color: "#00693E", initials: "BNF" },
  bnf: { label: "Banco Nacional de Fomento", color: "#00693E", initials: "BNF" },
  "banco interfisa": { label: "Interfisa Banco", color: "#F39200" },
  interfisa: { label: "Interfisa Banco", color: "#F39200" },
  "banco fic": { label: "Banco FIC", color: "#C8102E", initials: "FIC" },
  fic: { label: "Banco FIC", color: "#C8102E", initials: "FIC" },
  bancop: { label: "Bancop", color: "#00468C" },
  "banco rio": { label: "Banco Río", color: "#1B5FA8" },
  "banco bilbao vizcaya argentaria": { label: "BBVA", color: "#072146", initials: "BBVA" },
  bbva: { label: "BBVA", color: "#072146", initials: "BBVA" },
};

/** Paleta del monograma para bancos fuera del registro (colores distinguibles). */
const MONOGRAM_COLORS = ["#0E5A8A", "#1D7A5A", "#7A4C2D", "#6D2C91", "#B23A48", "#2F5D8A", "#8A6D0B", "#3D5A40"];

/** Palabras que no aportan iniciales propias cuando hay otras disponibles. */
const STOP_WORDS = new Set(["banco", "bank", "de", "del", "la", "las", "los", "y", "e", "sa", "s", "a", "sociedad", "anonima", "financiera", "cooperativa"]);

/** Clave canónica: minúsculas, sin acentos, sin signos y con espacios simples. */
export function bankKey(bank: string | null | undefined): string {
  return String(bank ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function initialsOf(name: string): string {
  const words = bankKey(name).split(" ").filter(Boolean);
  if (words.length === 0) return "B";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  // Con dos palabras (ej.: "Banco Continental") las dos iniciales aportan; con
  // más, se saltean los genéricos para quedarse con las palabras propias.
  const significant = words.length > 2 ? words.filter((word) => !STOP_WORDS.has(word)) : words;
  const source = significant.length >= 2 ? significant : words;
  return source
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/** Color estable de la paleta: mismo nombre → mismo color (hash simple, sin estado). */
function paletteColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
}

/** Marca del banco a partir del nombre tipeado por la empresa; `null` sin nombre. */
export function bankMark(bank: string | null | undefined): BankMark | null {
  const typed = String(bank ?? "").trim();
  if (!typed) return null;
  const key = bankKey(typed);
  const record = BANK_REGISTRY[key];
  return {
    key,
    label: record?.label || typed,
    initials: record?.initials || initialsOf(typed),
    color: record?.color || paletteColor(key),
    asset: record?.asset ?? null,
  };
}
