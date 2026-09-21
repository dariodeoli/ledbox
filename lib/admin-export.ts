/**
 * Exportaciones del panel (fuente única): CSV para planilla y helpers de impresión.
 *
 * Decisión de implementación (issue #7):
 * - El CSV se arma en el cliente con `Blob` a partir de los mismos datos y filtros
 *   que el módulo ya muestra en pantalla, sin endpoint nuevo: no hay riesgo de que
 *   el archivo y la lista difieran, y no hace falta repetir la validación de rol.
 * - Las vistas imprimibles (`/imprimir/...`) son server-side: necesitan la sesión y
 *   el filtro por empresa, y de ahí sale el PDF del navegador (`window.print()` en
 *   pantalla, `Page.printToPDF` en la verificación).
 *
 * Formato del CSV: separador `;` y BOM UTF-8 (Excel es-PY lo abre en columnas sin
 * asistente). Los montos van como entero sin separador de miles (la planilla suma)
 * y las fechas en ISO con la zona de la empresa (`America/Asuncion`).
 */

export type CsvCell = string | number | null | undefined;

export type CsvBlock = {
  /** Título opcional que se escribe arriba del encabezado (secciones del reporte). */
  title?: string;
  header: string[];
  rows: CsvCell[][];
};

const CSV_SEPARATOR = ";";
const CSV_NEWLINE = "\r\n";
const CSV_BOM = "\ufeff";
const TIME_ZONE = "America/Asuncion";

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV completo a partir de bloques; un renglón en blanco separa cada bloque. */
export function buildCsv(blocks: CsvBlock[]): string {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    if (index > 0) lines.push("");
    if (block.title) lines.push(csvCell(block.title));
    lines.push(block.header.map(csvCell).join(CSV_SEPARATOR));
    for (const row of block.rows) lines.push(row.map(csvCell).join(CSV_SEPARATOR));
  });
  return `${CSV_BOM}${lines.join(CSV_NEWLINE)}${CSV_NEWLINE}`;
}

/** Descarga el CSV en el navegador (no-op si corre en el servidor). */
export function downloadCsv(filename: string, blocks: CsvBlock[]): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([buildCsv(blocks)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Día de Asunción en ISO (`2026-09-21`); vacío si la fecha no es válida. */
export function csvDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = dayParts.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Fecha y hora de Asunción para planilla (`2026-09-21 15:04`). */
export function csvStamp(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = timeParts.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return `${csvDay(date)} ${hour}:${pick("minute")}`;
}

export function csvBool(value: boolean): string {
  return value ? "Sí" : "No";
}

/** Nombre del archivo con el día de Asunción: `ledbox-inventario-2026-09-21.csv`. */
export function csvFilename(prefix: string, day = csvDay(new Date())): string {
  const slug = prefix
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `ledbox-${slug || "export"}-${day || "hoy"}.csv`;
}
