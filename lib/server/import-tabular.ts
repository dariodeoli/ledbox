/**
 * Planillas de importación: plantilla .xlsx / .csv y lectura de ambas.
 *
 * Decisión de librería: no hay lector de xlsx en el proyecto y SheetJS (la
 * opción conocida) está abandonada en npm y arrastra avisos de seguridad. Un
 * .xlsx es un ZIP de XML, así que alcanza con `fflate` (0.8.2, una sola
 * dependencia sin transitivas, ya necesaria para el ZIP de fotos) y un lector
 * mínimo de la primera hoja con datos. Solo se leen celdas de texto y número:
 * no se evalúan fórmulas ni macros.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { CATALOG_LIMITS } from "@/lib/import-catalog";
import { importHeaders, type ImportModule } from "@/lib/import-modules";

export type SheetRows = Array<Record<string, string>>;

// ── CSV ─────────────────────────────────────────────────────────────────────

const escapeCsv = (value: string, delimiter: string) =>
  /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;

/** CSV con BOM UTF-8 (Excel lo abre con tildes bien). */
export function buildCsv(rows: string[][], delimiter = ","): string {
  return `﻿${rows.map((row) => row.map((cell) => escapeCsv(cell, delimiter)).join(delimiter)).join("\r\n")}\r\n`;
}

/** Lee CSV (coma o punto y coma, comillas RFC 4180, BOM). */
export function parseCsv(content: string): string[][] {
  const text = content.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

// ── XLSX: escritura ─────────────────────────────────────────────────────────

const xmlEscape = (value: string) =>
  value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetXml(rows: string[][], widths: number[]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : "";
          return value === "" ? "" : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

/** Arma un .xlsx con una hoja por entrada (la primera fila de cada hoja va en negrita). */
export function buildXlsx(sheets: Array<{ name: string; rows: string[][]; widths?: number[] }>): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    ),
  };
  sheets.forEach((sheet, i) => {
    const widths = sheet.widths ?? sheet.rows[0]?.map(() => 22) ?? [];
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows, widths));
  });
  return zipSync(files, { level: 6 });
}

// ── XLSX: lectura ───────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const xmlUnescape = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? "";
  });

const textRuns = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1])).join("");

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** Filas (matriz de texto) de la hoja que corresponde: «preferred» o la primera. */
export function readXlsx(data: Uint8Array, preferredSheet?: string): string[][] {
  let inflated = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter(file) {
        inflated += file.originalSize;
        if (inflated > 60 * 1024 * 1024 || file.originalSize > 40 * 1024 * 1024) throw new Error("planilla demasiado grande");
        return /^(xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml))$/.test(file.name);
      },
    });
  } catch {
    throw new Error("La planilla no es un .xlsx válido.");
  }
  const workbook = files["xl/workbook.xml"];
  if (!workbook) throw new Error("La planilla no es un .xlsx válido.");
  const sheets = [...strFromU8(workbook).matchAll(/<sheet\b[^>]*>/g)].map((match) => ({
    name: xmlUnescape(match[0].match(/\bname="([^"]*)"/)?.[1] ?? ""),
    rid: match[0].match(/\br:id="([^"]*)"/)?.[1] ?? "",
  }));
  const rels = new Map(
    [...strFromU8(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array()).matchAll(/<Relationship\b[^>]*>/g)].map((match) => [
      match[0].match(/\bId="([^"]*)"/)?.[1] ?? "",
      (match[0].match(/\bTarget="([^"]*)"/)?.[1] ?? "").replace(/^\/?(xl\/)?/, "xl/"),
    ]),
  );
  const chosen = sheets.find((sheet) => preferredSheet && sheet.name.toLowerCase() === preferredSheet.toLowerCase()) ?? sheets[0];
  const sheetFile = chosen && files[rels.get(chosen.rid) ?? ""];
  if (!sheetFile) throw new Error("La planilla no tiene hojas con datos.");

  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const match of strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textRuns(match[1]));
  }
  const rows: string[][] = [];
  for (const rowMatch of strFromU8(sheetFile).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] ?? "";
      const index = columnIndex(attrs.match(/\br="([^"]*)"/)?.[1] ?? "");
      if (index < 0 || index > 200) continue;
      const type = attrs.match(/\bt="([^"]*)"/)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") value = textRuns(inner);
      else {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        value = type === "s" ? (shared[Number(raw)] ?? "") : xmlUnescape(raw);
      }
      while (row.length < index) row.push("");
      row[index] = value.trim();
    }
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

// ── Plantilla y lectura por módulo ──────────────────────────────────────────

export function templateRows(module: ImportModule): string[][] {
  return [importHeaders(module), module.columns.map((column) => column.example)];
}

export function templateXlsx(module: ImportModule): Uint8Array {
  const instructions: string[][] = [
    ["Instrucciones"],
    ...module.instructions.map((line) => [line]),
    [""],
    ["Columna", "Obligatoria", "Qué va"],
    ...module.columns.map((column) => [column.key, column.required ? "Sí" : "No", column.help]),
  ];
  return buildXlsx([
    { name: module.sheetName, rows: templateRows(module), widths: module.columns.map((column) => Math.max(14, column.key.length + 6)) },
    { name: "Instrucciones", rows: instructions, widths: [90, 12, 90] },
  ]);
}

export const templateCsv = (module: ImportModule): string => buildCsv(templateRows(module));

/** Filas con clave = encabezado, listas para `normalizeCatalog`. */
export function rowsToObjects(module: ImportModule, matrix: string[][]): { ok: true; rows: SheetRows } | { ok: false; error: string } {
  if (matrix.length === 0) return { ok: false, error: "La planilla está vacía." };
  const expected = importHeaders(module);
  const header = matrix[0].map((cell) => cell.trim().toLowerCase());
  const missing = expected.filter((key) => !header.includes(key));
  if (missing.length > 0) {
    return { ok: false, error: `Faltan columnas en la planilla: ${missing.join(", ")}. Usá «Descargar plantilla» y no cambies los encabezados.` };
  }
  const rows = matrix.slice(1).map((cells) => {
    const object: Record<string, string> = {};
    expected.forEach((key) => {
      object[key] = (cells[header.indexOf(key)] ?? "").trim();
    });
    return object;
  });
  // La fila de ejemplo intacta de la plantilla no se importa.
  const example = module.columns.map((column) => column.example);
  const isExample = (row: Record<string, string>) => expected.every((key, i) => row[key] === example[i]);
  return { ok: true, rows: rows.filter((row) => !isExample(row)) };
}

/** Lee una planilla (.xlsx por firma ZIP «PK», si no CSV) y devuelve objetos por columna. */
export function readSheetFile(module: ImportModule, data: Uint8Array): { ok: true; rows: SheetRows } | { ok: false; error: string } {
  if (data.byteLength > CATALOG_LIMITS.sheetBytes) return { ok: false, error: "La planilla supera los 5 MB." };
  try {
    const isXlsx = data[0] === 0x50 && data[1] === 0x4b;
    const matrix = isXlsx ? readXlsx(data, module.sheetName) : parseCsv(new TextDecoder("utf-8").decode(data));
    return rowsToObjects(module, matrix);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No pudimos leer la planilla." };
  }
}
