/**
 * Conciliación bancaria (issue #40): reglas puras del extracto.
 *
 * Acá vive todo lo que no toca la base ni el DOM, la usa el cliente (vista
 * previa y sugerencias) y la revalida el API al importar (fuente única):
 *
 * - Lectura de CSV/TSV pegado o subido (comillas, saltos de línea y BOM).
 * - Mapeo de columnas asistido por los nombres del encabezado.
 * - Normalización y validación por fila: fecha, descripción, referencia,
 *   débito/crédito o monto con signo, en guaraníes enteros.
 * - Huella de la fila para detectar duplicados entre extractos.
 * - Sugerencias de match contra movimientos de tesorería: misma cuenta, mismo
 *   signo e importe y fecha dentro de la ventana (default ±3 días).
 */

export const STATEMENT_CSV_MAX_CHARS = 512 * 1024;
export const STATEMENT_MAX_ROWS = 500;
/** Tope de filas del extracto que el listado del panel devuelve de una vez. */
export const STATEMENT_MAX_LIST_ROWS = 300;
/** Tope de movimientos candidatos que la ventana de conciliación devuelve. */
export const STATEMENT_MAX_CANDIDATES = 100;
export const STATEMENT_MATCH_WINDOW_DAYS = 3;
export const STATEMENT_MAX_AMOUNT = 99_000_000_000;
export const STATEMENT_MAX_DESCRIPTION = 200;
export const STATEMENT_MAX_REFERENCE = 120;
export const STATEMENT_MAX_RAW = 1000;

const DAY_MS = 86_400_000;

/** Dirección de una fila del extracto (`BankStatementRowDirection`). */
export const STATEMENT_DIRECTIONS = ["DEBIT", "CREDIT"] as const;
export type StatementDirectionValue = (typeof STATEMENT_DIRECTIONS)[number];

/** Estados de una fila del extracto (`BankStatementRowStatus`). */
export const STATEMENT_ROW_STATUSES = ["PENDING", "MATCHED", "IGNORED"] as const;
export type StatementRowStatusValue = (typeof STATEMENT_ROW_STATUSES)[number];

/** Columnas del CSV que el usuario mapea a los campos de la fila (`-1` = sin usar). */
export type StatementCsvMapping = {
  date: number;
  description: number;
  reference: number;
  debit: number;
  credit: number;
  amount: number;
};

export const EMPTY_STATEMENT_MAPPING: StatementCsvMapping = {
  date: -1,
  description: -1,
  reference: -1,
  debit: -1,
  credit: -1,
  amount: -1,
};

export type StatementCsvRecord = {
  /** Línea física del archivo donde empieza el registro (1-based). */
  line: number;
  /** Texto original del registro, tal cual estaba en el archivo. */
  raw: string;
  cells: string[];
};

export type ParsedStatementCsv = {
  delimiter: string;
  header: string[];
  records: StatementCsvRecord[];
};

export type ParsedStatementRow = {
  line: number;
  raw: string;
  /** Día de Asunción `YYYY-MM-DD`. */
  date: string | null;
  description: string;
  reference: string | null;
  direction: StatementDirectionValue | null;
  /** Monto absoluto en guaraníes; el signo lo da `direction`. */
  amount: number | null;
  /** Motivo real del descarte; `null` cuando la fila es importable. */
  error: string | null;
};

export type StatementPreview = {
  delimiter: string;
  header: string[];
  rows: ParsedStatementRow[];
  /** Filas de datos leídas (sin encabezado ni renglones en blanco). */
  total: number;
  ok: number;
  errors: number;
};

const BOM = /^\uFEFF/;
const ISO_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const LOCAL_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Asuncion",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día de Asunción (`YYYY-MM-DD`) de un instante real; `null` si no es una fecha. */
export function statementDayKeyOfInstant(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dayFormat.format(date);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Día `YYYY-MM-DD` en milisegundos UTC (para distancias entre días puros). */
function dayKeyToUtcMs(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Día de Asunción de una fila del extracto: ISO, `DD/MM/AAAA` o `DD-MM-AA`. */
export function parseStatementDayKey(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO_DATE.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const local = LOCAL_DATE.exec(text);
    if (!local) return null;
    day = Number(local[1]);
    month = Number(local[2]);
    year = local[3].length === 2 ? 2000 + Number(local[3]) : Number(local[3]);
  }
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export type StatementAmountResult = { ok: true; amount: number } | { ok: false; error: string };

/**
 * Monto del extracto en guaraníes enteros. Acepta `1.500.000`, `1,500,000`,
 * `1500000.00`, `Gs. 1.500.000`, `-1500000` y `(1500000)`. Los centavos con
 * valor (no `.00`) son error: el sistema guarda PYG enteros.
 */
export function parseStatementAmount(raw: string): StatementAmountResult {
  const original = raw.trim();
  let text = original;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text
    .replace(/\s|\u00a0/g, "")
    .replace(/^(gs\.?|pyg|₲)/i, "")
    .replace(/(gs\.?|pyg|₲)$/i, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(text)) return { ok: false, error: `El monto «${original}» no es un número válido.` };
  const lastSeparator = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
  let integerPart = text;
  let decimalPart = "";
  if (lastSeparator >= 0) {
    const tail = text.slice(lastSeparator + 1);
    if (/^\d{1,2}$/.test(tail)) {
      integerPart = text.slice(0, lastSeparator);
      decimalPart = tail;
    }
  }
  const digits = integerPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: `El monto «${original}» no es un número válido.` };
  if (/[1-9]/.test(decimalPart)) {
    return { ok: false, error: `El monto «${original}» tiene centavos: el extracto se guarda en guaraníes enteros.` };
  }
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: `El monto «${original}» tiene que ser mayor a cero.` };
  }
  if (amount > STATEMENT_MAX_AMOUNT) {
    return { ok: false, error: `El monto «${original}» supera el máximo permitido (99.000.000.000 Gs.).` };
  }
  return { ok: true, amount: negative ? -amount : amount };
}

/** Separa el CSV/TSV pegado en registros; tolera comillas, CRLF y BOM. */
export function parseStatementCsv(text: string): ParsedStatementCsv {
  const source = text.replace(BOM, "");
  const firstLine = source.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const delimiter = detectDelimiter(firstLine);
  const parsed = parseRecords(source, delimiter);
  const headerIndex = parsed.findIndex((record) => record.cells.some((cell) => cell.trim() !== ""));
  if (headerIndex < 0) return { delimiter, header: [], records: [] };
  const header = parsed[headerIndex].cells.map((cell) => cell.trim());
  const records = parsed
    .slice(headerIndex + 1)
    .filter((record) => record.cells.some((cell) => cell.trim() !== ""));
  return { delimiter, header, records };
}

function detectDelimiter(line: string): string {
  const sample = line.replace(/"[^"]*"/g, '""');
  let best = ",";
  let bestCount = 0;
  for (const candidate of [";", ",", "\t", "|"]) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseRecords(source: string, delimiter: string): StatementCsvRecord[] {
  const records: StatementCsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let recordStart = -1;
  let started = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (recordStart < 0) recordStart = index;
      inQuotes = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      if (recordStart < 0) recordStart = index;
      cells.push(field);
      field = "";
      started = true;
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      cells.push(field);
      records.push({ line: recordLine, raw: source.slice(recordStart < 0 ? index : recordStart, index).slice(0, STATEMENT_MAX_RAW), cells });
      cells = [];
      field = "";
      started = false;
      recordStart = -1;
      line += 1;
      recordLine = line;
      continue;
    }
    if (recordStart < 0) recordStart = index;
    started = true;
    field += char;
  }
  if (started || field !== "" || cells.length > 0) {
    cells.push(field);
    records.push({
      line: recordLine,
      raw: source.slice(recordStart < 0 ? source.length : recordStart).slice(0, STATEMENT_MAX_RAW),
      cells,
    });
  }
  return records;
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const DATE_TOKENS = ["fecha", "fecha mov", "fecha movimiento", "fecha de movimiento", "date", "dia"];
const DESCRIPTION_TOKENS = ["descripcion", "detalle", "concepto", "movimiento", "descripcion del movimiento", "glosa", "leyenda", "historico"];
const REFERENCE_TOKENS = [
  "referencia",
  "referencia del movimiento",
  "ref",
  "documento",
  "nro documento",
  "nro doc",
  "n documento",
  "n doc",
  "numero documento",
  "numero",
  "nro",
  "comprobante",
  "codigo",
  "operacion",
];
const DEBIT_TOKENS = ["debito", "debitos", "debe", "cargo", "cargos", "debit", "salida", "egreso", "debito gs"];
const CREDIT_TOKENS = ["credito", "creditos", "haber", "abono", "abonos", "credit", "entrada", "ingreso", "credito gs"];
const AMOUNT_TOKENS = ["monto", "importe", "valor", "amount", "monto gs", "importe gs", "total"];

/** Índice de la columna que mejor describe el rol, `-1` si ninguna. */
function matchColumn(header: readonly string[], tokens: readonly string[]): number {
  const normalized = header.map(normalizeToken);
  for (const token of tokens) {
    const exact = normalized.indexOf(token);
    if (exact >= 0) return exact;
  }
  for (const token of tokens) {
    const partial = normalized.findIndex((value) => value === token || value.split(" ").includes(token));
    if (partial >= 0) return partial;
  }
  for (const token of tokens) {
    const partial = normalized.findIndex((value) => value.includes(token));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** Mapeo asistido por los nombres del encabezado (el usuario lo corrige). */
export function suggestStatementMapping(header: readonly string[]): StatementCsvMapping {
  const used = new Set<number>();
  const take = (index: number): number => {
    if (index < 0 || used.has(index)) return -1;
    used.add(index);
    return index;
  };
  const debit = take(matchColumn(header, DEBIT_TOKENS));
  const credit = take(matchColumn(header, CREDIT_TOKENS));
  const amount = take(matchColumn(header, AMOUNT_TOKENS));
  const date = take(matchColumn(header, DATE_TOKENS));
  const description = take(matchColumn(header, DESCRIPTION_TOKENS));
  const reference = take(matchColumn(header, REFERENCE_TOKENS));
  return { date, description, reference, debit, credit, amount };
}

/** Error de mapeo legible; `null` cuando el mapeo alcanza para leer el archivo. */
export function validateStatementMapping(mapping: StatementCsvMapping, header: readonly string[]): string | null {
  if (mapping.date < 0) return "Elegí la columna de la fecha.";
  if (mapping.description < 0) return "Elegí la columna de la descripción.";
  const hasDebit = mapping.debit >= 0;
  const hasCredit = mapping.credit >= 0;
  if (hasDebit !== hasCredit) return "Elegí las dos columnas de débito y crédito, o una columna de monto.";
  if (!hasDebit && mapping.amount < 0) return "Elegí las columnas de débito y crédito, o una columna de monto.";
  const used = [mapping.date, mapping.description, mapping.reference, mapping.debit, mapping.credit, mapping.amount].filter(
    (index) => index >= 0,
  );
  if (new Set(used).size !== used.length) return "Cada rol del mapeo tiene que usar una columna distinta.";
  if (used.some((index) => index >= header.length)) return "El archivo cambió: volvé a revisar el mapeo de columnas.";
  return null;
}

/**
 * Normaliza y valida cada fila con el mapeo elegido. Las filas con `error` no
 * se importan; el conteo queda a la vista en la vista previa.
 */
export function buildStatementPreview(csv: ParsedStatementCsv, mapping: StatementCsvMapping): StatementPreview {
  const rows: ParsedStatementRow[] = [];
  for (const record of csv.records) {
    if (rows.length >= STATEMENT_MAX_ROWS) break;
    rows.push(buildStatementRow(record, mapping));
  }
  const errors = rows.filter((row) => row.error).length;
  return {
    delimiter: csv.delimiter,
    header: csv.header,
    rows,
    total: rows.length,
    ok: rows.length - errors,
    errors,
  };
}

function cellOf(record: StatementCsvRecord, index: number): string {
  if (index < 0 || index >= record.cells.length) return "";
  return record.cells[index].trim();
}

function buildStatementRow(record: StatementCsvRecord, mapping: StatementCsvMapping): ParsedStatementRow {
  const description = cellOf(record, mapping.description).slice(0, STATEMENT_MAX_DESCRIPTION);
  const reference = cellOf(record, mapping.reference).slice(0, STATEMENT_MAX_REFERENCE) || null;
  const dateText = cellOf(record, mapping.date);
  const date = parseStatementDayKey(dateText);
  const base: ParsedStatementRow = {
    line: record.line,
    raw: record.raw,
    date,
    description,
    reference,
    direction: null,
    amount: null,
    error: null,
  };
  if (!dateText) return { ...base, error: "La fila no tiene fecha." };
  if (!date) return { ...base, error: `La fecha «${dateText}» no es válida (usá AAAA-MM-DD o DD/MM/AAAA).` };
  if (!description) return { ...base, error: "La fila no tiene descripción." };

  if (mapping.debit >= 0 && mapping.credit >= 0) {
    const debitText = cellOf(record, mapping.debit);
    const creditText = cellOf(record, mapping.credit);
    if (debitText && creditText) return { ...base, error: "La fila tiene débito y crédito a la vez." };
    if (!debitText && !creditText) return { ...base, error: "La fila no tiene débito ni crédito." };
    const parsed = parseStatementAmount(debitText || creditText);
    if (!parsed.ok) return { ...base, error: parsed.error };
    return { ...base, direction: debitText ? "DEBIT" : "CREDIT", amount: parsed.amount };
  }

  const amountText = cellOf(record, mapping.amount);
  if (!amountText) return { ...base, error: "La fila no tiene monto." };
  const parsed = parseStatementAmount(amountText);
  if (!parsed.ok) return { ...base, error: parsed.error };
  return {
    ...base,
    direction: parsed.amount < 0 ? "DEBIT" : "CREDIT",
    amount: Math.abs(parsed.amount),
  };
}

/** Huella estable de una fila: detecta el mismo movimiento en dos extractos. */
export function statementRowFingerprint(row: {
  date: string;
  direction: StatementDirectionValue;
  amount: number;
  description: string;
  reference?: string | null;
}): string {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 120);
  return [row.date, row.direction, row.amount, normalize(row.description), normalize(row.reference ?? "")].join("|");
}

/** Signo de una fila del extracto: el débito sale (−), el crédito entra (+). */
export function statementRowSign(direction: StatementDirectionValue): 1 | -1 {
  return direction === "DEBIT" ? -1 : 1;
}

export type StatementMatchMovement = {
  id: string;
  accountId: string;
  counterAccountId: string | null;
  direction: string;
  amount: number;
  occurredAt: string;
};

/**
 * Signo de un movimiento de tesorería **para una cuenta**: entrada (+), salida
 * (−) y transferencia (resta en la cuenta origen y suma en la destino). Cero
 * cuando el movimiento no toca la cuenta.
 */
export function movementSign(
  movement: Pick<StatementMatchMovement, "accountId" | "counterAccountId" | "direction">,
  accountId: string,
): 1 | -1 | 0 {
  if (movement.counterAccountId === accountId) return 1;
  if (movement.accountId !== accountId) return 0;
  return movement.direction === "IN" ? 1 : -1;
}

/**
 * Candidatos de match para una fila: mismos signo e importe en la misma cuenta y
 * fecha dentro de la ventana (default ±3 días), ordenados por cercanía. Es
 * genérica para devolver el mismo tipo de movimiento que recibe (el del API).
 */
export function statementMatchCandidates<T extends StatementMatchMovement>(
  row: { date: string; direction: StatementDirectionValue; amount: number },
  movements: readonly T[],
  accountId: string,
  windowDays: number = STATEMENT_MATCH_WINDOW_DAYS,
): T[] {
  const sign = statementRowSign(row.direction);
  const rowMs = dayKeyToUtcMs(row.date);
  return movements
    .filter((movement) => movementSign(movement, accountId) === sign && movement.amount === row.amount)
    .map((movement) => {
      const dayKey = statementDayKeyOfInstant(movement.occurredAt);
      const distance = dayKey ? Math.abs(dayKeyToUtcMs(dayKey) - rowMs) : Number.POSITIVE_INFINITY;
      return { movement, distance };
    })
    .filter((entry) => entry.distance <= windowDays * DAY_MS)
    .sort((a, b) => a.distance - b.distance || a.movement.occurredAt.localeCompare(b.movement.occurredAt))
    .map((entry) => entry.movement);
}
