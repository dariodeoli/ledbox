/**
 * Importación de eventos con productos («Eventos → Importar»): formato, lectura
 * y validación. Módulo puro (sin base ni servidor): lo usan el panel, las rutas
 * y los tests. La parte con base de datos está en `lib/server/import-eventos.ts`.
 *
 * Formato JSON (`eventos.json`):
 *   { "eventos": [{ "codigo", "nombre", "cliente": { "nombre", "telefono", "correo" },
 *     "desde", "hasta", "lugar", "estado", "productos": [{ "codigo", "cantidad" }], "notas" }] }
 *
 * Regla de oro de este módulo: lo que no se entiende se rechaza o se avisa; nunca
 * se inventa un dato (ni una fecha, ni un estado, ni un cliente).
 */

import { emailValid, inventorySkuValid, normalizeEmail, normalizeInventorySku, normalizePhone, phoneValid } from "@/lib/field-rules";

export const EVENTOS_LIMITS = {
  /** Eventos por archivo. */
  events: 500,
  /** Líneas de productos por evento. */
  lines: 200,
  codeMax: 60,
  nameMax: 200,
  clientMax: 160,
  placeMax: 200,
  notesMax: 2000,
} as const;

export const EVENTO_ESTADOS = ["confirmado", "borrador", "tentativo", "cancelado"] as const;
export type EventoEstado = (typeof EVENTO_ESTADOS)[number];

export type EventoLinea = { codigo: string; cantidad: number };

export type EventoCliente = { nombre: string; telefono: string | null; correo: string | null };

export type EventoDoc = {
  /** Fila (o posición) en el archivo, desde 1: para mensajes. */
  fila: number;
  codigo: string;
  nombre: string;
  cliente: EventoCliente;
  /** Día `AAAA-MM-DD` (se interpreta en la zona horaria de la empresa). */
  desde: string;
  hasta: string;
  lugar: string | null;
  estado: EventoEstado;
  productos: EventoLinea[];
  notas: string | null;
};

export type EventoProblemKind =
  | "archivo"
  | "codigo"
  | "nombre"
  | "cliente"
  | "fecha"
  | "estado"
  | "producto"
  | "duplicado"
  | "contacto"
  | "texto"
  | "stock"
  | "plan";

export type EventoProblem = {
  nivel: "error" | "aviso";
  tipo: EventoProblemKind;
  codigo: string | null;
  fila: number | null;
  mensaje: string;
};

const problem = (nivel: EventoProblem["nivel"], tipo: EventoProblemKind, codigo: string | null, fila: number | null, mensaje: string): EventoProblem => ({ nivel, tipo, codigo, fila, mensaje });

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/·-]{0,59}$/;

export const normalizeEventoCode = (value: unknown): string => normalizeInventorySku(value === null || value === undefined ? "" : String(value)).replace(/\s+/g, " ");

function text(value: unknown, max: number): string | null | false {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number") return false;
  const clean = String(value).trim().replace(/\s+/g, " ");
  if (!clean) return null;
  return clean.length > max ? false : clean;
}

/** Notas: conserva los saltos de línea. */
function notesText(value: unknown): string | null | false {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return false;
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (!clean) return null;
  return clean.length > EVENTOS_LIMITS.notesMax ? false : clean;
}

// ── Fechas ──────────────────────────────────────────────────────────────────

function validDayKey(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Día `AAAA-MM-DD` desde ISO (`2026-11-14`, con hora opcional), `dd/mm/aaaa` (también con guion o
 * punto) o el número de serie que Excel guarda en una celda de fecha. `null` si no se entiende:
 * jamás se adivina (`03/04/2026` es 3 de abril, nunca 4 de marzo).
 */
export function parseEventoDay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (iso) return validDayKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (local) return validDayKey(Number(local[3]), Number(local[2]), Number(local[1]));
  // Número de serie de Excel (días desde 1899-12-30); solo el rango de fechas razonable.
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw));
    if (serial >= 36526 && serial <= 73415) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return validDayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  return null;
}

// ── Estado ──────────────────────────────────────────────────────────────────

const ESTADO_ALIAS: Record<string, EventoEstado> = {
  confirmado: "confirmado",
  confirmada: "confirmado",
  confirmed: "confirmado",
  borrador: "borrador",
  draft: "borrador",
  tentativo: "tentativo",
  tentativa: "tentativo",
  pendiente: "tentativo",
  cancelado: "cancelado",
  cancelada: "cancelado",
  cancelled: "cancelado",
  canceled: "cancelado",
};

export function parseEventoEstado(value: unknown): EventoEstado | null {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return ESTADO_ALIAS[key] ?? null;
}

// ── Productos ───────────────────────────────────────────────────────────────

/** «527x1; 1482 x 10» → líneas. Cada parte es `código x cantidad`; sin «x» la cantidad es 1. */
export function parseProductosTexto(raw: string): { ok: true; lineas: EventoLinea[] } | { ok: false; error: string } {
  const lineas: EventoLinea[] = [];
  for (const part of raw.split(/[;\n]/)) {
    const piece = part.trim();
    if (!piece) continue;
    const match = piece.match(/^(.*?)\s*[xX×]\s*(\d+)$/);
    const codigo = normalizeEventoCode(match ? match[1] : piece);
    const cantidad = match ? Number(match[2]) : 1;
    if (!codigo || !Number.isSafeInteger(cantidad) || cantidad < 1) return { ok: false, error: `«${piece}» no tiene el formato «codigo x cantidad».` };
    lineas.push({ codigo, cantidad });
  }
  return { ok: true, lineas };
}

function readProductos(raw: unknown, push: (p: EventoProblem) => void, codigo: string, fila: number): EventoLinea[] | null {
  let entries: Array<{ codigo: unknown; cantidad: unknown }>;
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw === "string") {
    const parsed = parseProductosTexto(raw);
    if (!parsed.ok) {
      push(problem("error", "producto", codigo, fila, parsed.error));
      return null;
    }
    entries = parsed.lineas;
  } else if (Array.isArray(raw)) {
    entries = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        push(problem("error", "producto", codigo, fila, "Una línea de productos no tiene el formato {codigo, cantidad}."));
        return null;
      }
      const record = entry as Record<string, unknown>;
      entries.push({ codigo: record.codigo, cantidad: record.cantidad ?? 1 });
    }
  } else {
    push(problem("error", "producto", codigo, fila, "«productos» tiene que ser una lista de {codigo, cantidad}."));
    return null;
  }
  if (entries.length > EVENTOS_LIMITS.lines) {
    push(problem("error", "producto", codigo, fila, `Un evento no puede tener más de ${EVENTOS_LIMITS.lines} líneas de productos.`));
    return null;
  }
  const merged = new Map<string, number>();
  for (const entry of entries) {
    const code = normalizeEventoCode(entry.codigo);
    const rawQty = typeof entry.cantidad === "string" ? entry.cantidad.trim() : entry.cantidad;
    const qty = typeof rawQty === "number" ? rawQty : /^\d+$/.test(String(rawQty ?? "")) ? Number(rawQty) : NaN;
    if (code && !inventorySkuValid(code)) {
      push(problem("error", "producto", codigo, fila, `El código de producto «${code}» tiene caracteres que no puede tener un SKU.`));
      return null;
    }
    if (!code || !Number.isSafeInteger(qty) || qty < 1 || qty > 100_000) {
      push(problem("error", "producto", codigo, fila, `La línea «${code || "sin código"}» necesita una cantidad entera de 1 o más.`));
      return null;
    }
    if (merged.has(code)) push(problem("aviso", "producto", codigo, fila, `El producto «${code}» está repetido: se suman las cantidades.`));
    merged.set(code, (merged.get(code) ?? 0) + qty);
  }
  return [...merged].map(([code, cantidad]) => ({ codigo: code, cantidad }));
}

// ── Normalización ───────────────────────────────────────────────────────────

export type EventosNormalized = { eventos: EventoDoc[]; problems: EventoProblem[] };

/**
 * Valida el documento (JSON de ChatGPT o filas de planilla ya convertidas). Un evento con un
 * error se descarta (el resto sigue); los avisos no bloquean. Nunca lanza.
 */
export function normalizeEventos(raw: unknown): { ok: true; value: EventosNormalized } | { ok: false; error: string } {
  const list = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).eventos : raw;
  if (!Array.isArray(list)) return { ok: false, error: "El archivo no trae una lista «eventos»." };
  if (list.length === 0) return { ok: false, error: "El archivo no trae eventos." };
  if (list.length > EVENTOS_LIMITS.events) return { ok: false, error: `El archivo trae ${list.length} eventos; el máximo es ${EVENTOS_LIMITS.events}. Dividilo en varios.` };

  const problems: EventoProblem[] = [];
  const eventos: EventoDoc[] = [];
  const seen = new Map<string, number>();
  list.forEach((entry, index) => {
    const fila = index + 1;
    const push = (p: EventoProblem) => problems.push(p);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      push(problem("error", "archivo", null, fila, `La fila ${fila} no es un evento.`));
      return;
    }
    const row = entry as Record<string, unknown>;
    const codigo = normalizeEventoCode(row.codigo);
    if (!codigo || !CODE_RE.test(codigo)) {
      push(problem("error", "codigo", codigo || null, fila, `Fila ${fila}: el código del evento es obligatorio (1 a ${EVENTOS_LIMITS.codeMax} caracteres: letras, números, espacio, punto, guion o barra).`));
      return;
    }
    const duplicate = seen.get(codigo.toLowerCase());
    if (duplicate) {
      push(problem("error", "duplicado", codigo, fila, `El código «${codigo}» ya estaba en la fila ${duplicate}: se omite esta repetición.`));
      return;
    }
    seen.set(codigo.toLowerCase(), fila);

    const errors: EventoProblem[] = [];
    const fail = (tipo: EventoProblemKind, mensaje: string) => errors.push(problem("error", tipo, codigo, fila, mensaje));
    const nombre = text(row.nombre, EVENTOS_LIMITS.nameMax);
    if (!nombre || nombre.length < 2) fail("nombre", `Falta el nombre del evento (2 a ${EVENTOS_LIMITS.nameMax} caracteres).`);

    const clienteRaw = row.cliente;
    const clienteRecord: Record<string, unknown> =
      clienteRaw && typeof clienteRaw === "object" && !Array.isArray(clienteRaw)
        ? (clienteRaw as Record<string, unknown>)
        : { nombre: clienteRaw, telefono: row.telefono, correo: row.correo };
    // Planilla: «cliente», «telefono» y «correo» son columnas planas.
    if (clienteRaw && typeof clienteRaw === "object" && !Array.isArray(clienteRaw)) {
      clienteRecord.telefono ??= row.telefono;
      clienteRecord.correo ??= row.correo;
    }
    const clienteNombre = text(clienteRecord.nombre, EVENTOS_LIMITS.clientMax);
    if (!clienteNombre || clienteNombre.length < 2) fail("cliente", "Falta el nombre del cliente.");
    let telefono: string | null = null;
    const telefonoRaw = text(clienteRecord.telefono, 40);
    if (telefonoRaw) {
      // Formato local de Paraguay: «0981 123 456» es el +595 981 123 456 (el 0 inicial es de marcado nacional).
      const national = /^0[1-9]/.test(telefonoRaw.replace(/[\s().-]/g, "")) ? telefonoRaw.replace(/^\s*0/, "") : telefonoRaw;
      if (phoneValid(national)) telefono = normalizePhone(national);
      else push(problem("aviso", "contacto", codigo, fila, `El teléfono «${telefonoRaw}» no es válido: el cliente se busca solo por correo o nombre.`));
    }
    let correo: string | null = null;
    const correoRaw = text(clienteRecord.correo, 254);
    if (correoRaw) {
      if (emailValid(correoRaw)) correo = normalizeEmail(correoRaw);
      else push(problem("aviso", "contacto", codigo, fila, `El correo «${correoRaw}» no es válido: el cliente se busca solo por teléfono o nombre.`));
    }

    const desde = parseEventoDay(row.desde);
    const hasta = parseEventoDay(row.hasta);
    if (!desde) fail("fecha", row.desde ? `La fecha «desde» («${String(row.desde)}») no se entiende: usá AAAA-MM-DD o dd/mm/aaaa.` : "Falta la fecha «desde».");
    if (!hasta) fail("fecha", row.hasta ? `La fecha «hasta» («${String(row.hasta)}») no se entiende: usá AAAA-MM-DD o dd/mm/aaaa.` : "Falta la fecha «hasta» (si dura un solo día, repetí la misma).");
    if (desde && hasta && hasta < desde) fail("fecha", "La fecha «hasta» es anterior a «desde».");

    let estado: EventoEstado = "borrador";
    if (row.estado === null || row.estado === undefined || String(row.estado).trim() === "") {
      push(problem("aviso", "estado", codigo, fila, "Sin estado: se carga como borrador (no reserva stock)."));
    } else {
      const parsed = parseEventoEstado(row.estado);
      if (parsed) estado = parsed;
      else fail("estado", `El estado «${String(row.estado)}» no existe: usá confirmado, tentativo, borrador o cancelado.`);
    }

    const lugar = text(row.lugar, EVENTOS_LIMITS.placeMax);
    if (lugar === false) fail("texto", `El lugar supera los ${EVENTOS_LIMITS.placeMax} caracteres.`);
    const notas = notesText(row.notas);
    if (notas === false) fail("texto", `Las notas superan los ${EVENTOS_LIMITS.notesMax} caracteres.`);

    const productos = readProductos(row.productos, (p) => (p.nivel === "error" ? errors.push(p) : push(p)), codigo, fila);
    if (productos && productos.length === 0 && estado !== "cancelado") push(problem("aviso", "producto", codigo, fila, "El evento no trae productos: se carga sin reservas."));

    if (errors.length > 0 || !nombre || !clienteNombre || !desde || !hasta || productos === null || lugar === false || notas === false) {
      problems.push(...errors);
      return;
    }
    eventos.push({ fila, codigo, nombre, cliente: { nombre: clienteNombre, telefono, correo }, desde, hasta, lugar, estado, productos, notas });
  });
  return { ok: true, value: { eventos, problems } };
}

/** Texto de JSON (UTF-8, con o sin BOM) → eventos validados. */
export function parseEventosJson(content: string, maxBytes: number): { ok: true; value: EventosNormalized } | { ok: false; error: string } {
  if (new TextEncoder().encode(content).length > maxBytes) return { ok: false, error: "El JSON supera los 2 MB." };
  let raw: unknown;
  try {
    raw = JSON.parse(content.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "El archivo no es un JSON válido." };
  }
  return normalizeEventos(raw);
}

/** Texto del aviso por línea sin stock: «Lounge Oslo: piden 2, hay 1 libre en esas fechas». */
export function sinStockMensaje(nombre: string, piden: number, libres: number): string {
  return `${nombre}: piden ${piden}, hay ${libres} libre${libres === 1 ? "" : "s"} en esas fechas`;
}
