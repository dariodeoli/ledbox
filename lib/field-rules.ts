/**
 * Reglas puras de campos del panel (fuente única, testeable).
 *
 * Acá viven la normalización y la validación de teléfonos, correos, seriales,
 * montos PYG, porcentajes y la ayuda de ciudad. La UI dibuja el formato y el API
 * revalida siempre; el front solo ayuda. Un solo mensaje de error por regla.
 *
 * Adopción de `owncoding-ui` (issues #48 y #49): el teléfono y el monto PYG
 * delegan en la librería compartida (`parseTelefono`, `componerTelefono`,
 * `parseGsInput`) y el catálogo de ciudades sale de `CIUDADES_PARAGUAY` +
 * `departamentoDe`. La validación de teléfono y su mensaje quedan locales a
 * propósito: la librería es solo-móvil para Paraguay y rechazaría los fijos que
 * LedBox ya acepta y guarda (owncoding-ui#4).
 */

import {
  CIUDADES_PARAGUAY,
  caretTrasDigitos,
  componerTelefono,
  departamentoDe,
  excedeMonto,
  formatGsInput,
  largoMaximoMonto,
  limpiarPercent,
  normalizarMontoInput,
  parseGsInput,
  parseTelefono,
} from "owncoding-ui";

/**
 * El `.d.ts` de v0.14.0 publica firmas viejas del teléfono (owncoding-ui#4)
 * mientras el runtime devuelve `{ countryCode, phone }` y `componerTelefono`
 * recibe un objeto. Se ajustan acá, en un solo lugar, y no en cada consumidor.
 */
const parseTelefonoReal = parseTelefono as unknown as (
  valor: string,
  countryCodePorDefecto?: string,
) => { countryCode: string; phone: string };
const componerTelefonoReal = componerTelefono as unknown as (datos: {
  countryCode: string;
  phone: string;
}) => string | null;

/** Límites por tipo de dato (los mismos que la plantilla general). */
export const FIELD_LIMITS = {
  /** Nombres y responsables. */
  name: 120,
  /** Empresas y razones sociales. */
  company: 120,
  /** Direcciones. */
  address: 400,
  /** Notas y descripciones largas. */
  notes: 2000,
  /** Descripciones de trabajo. */
  description: 400,
  /** Correos: máximo del panel. */
  email: 200,
  /** Seriales/IMEI. */
  serial: 40,
  /** Monto general (compras, anticipos, cobros). */
  amountGeneral: 10_000_000_000,
  /** Monto de ventas: presupuestos y precios unitarios. */
  amountSales: 99_000_000_000,
} as const;

/** Código de país por defecto de los teléfonos (+595 Paraguay). */
export const DEFAULT_PHONE_COUNTRY = "595";

/** Mensaje único de cada regla (se muestra tal cual en el campo). */
export const FIELD_MESSAGES = {
  phone: "Ingresá un teléfono válido con código de país.",
  email: "Ingresá un correo válido.",
  serial: "El serial solo admite letras, números, guiones y guiones bajos.",
  amount: "Ingresá un monto válido en guaraníes.",
  amountLimit: "El monto supera el máximo permitido.",
  percent: "Ingresá un porcentaje entre 0 y 100.",
  name: "Ingresá un nombre de 2 a 120 caracteres.",
  required: "Este campo es obligatorio.",
  pin: "El PIN tiene que tener entre 4 y 6 dígitos.",
} as const;

/** Deja solo dígitos (cantidades, días, códigos numéricos). */
export function digitsOnly(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

/** PIN del panel (issue #21): 4–6 dígitos, nunca visible y validado al completarlo. */
export const PIN_MIN_DIGITS = 4;
export const PIN_MAX_DIGITS = 6;

/** Deja solo dígitos y corta al máximo del PIN (teclado numérico y pegado incluidos). */
export function pinInput(value: string): string {
  return digitsOnly(value).slice(0, PIN_MAX_DIGITS);
}

/** ¿PIN válido? (4–6 dígitos; el API revalida siempre). */
export function pinValid(value: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`).test(value ?? "");
}

export function pinError(value: string): string | null {
  return pinValid(value) ? null : FIELD_MESSAGES.pin;
}

/**
 * Pausa que cierra un PIN más corto que el máximo (issue #54): el panel no
 * guarda cuántos dígitos tiene el PIN, así que con 4 o más espera un instante a
 * que la persona termine de teclear antes de enviarlo. Quien va a escribir 6
 * sigue tecleando y la pausa se reinicia sola.
 */
export const PIN_SETTLE_MS = 900;

/**
 * ¿Ya se puede enviar el PIN que se está tecleando? (issue #54.)
 *
 * - Con `expectedLength` conocido (por ejemplo, el mismo largo del PIN nuevo al
 *   repetirlo): recién al llegar a ese largo, sin pausa ni adelantos.
 * - Sin largo conocido: al llegar al máximo (6) se envía al instante; con 4 o más
 *   dígitos, una pausa de `pausedMs` cierra el PIN corto.
 * - Menos de `PIN_MIN_DIGITS` dígitos: nunca.
 */
export function pinEntryComplete(value: string, pausedMs = 0, expectedLength?: number | null): boolean {
  const pin = pinInput(value);
  if (!pinValid(pin)) return false;
  if (typeof expectedLength === "number" && expectedLength >= PIN_MIN_DIGITS && expectedLength <= PIN_MAX_DIGITS) {
    return pin.length >= expectedLength;
  }
  if (pin.length >= PIN_MAX_DIGITS) return true;
  return pausedMs >= PIN_SETTLE_MS;
}

/** Nombre de persona como se guarda: sin espacios de más (el límite es `FIELD_LIMITS.name`). */
export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function personNameValid(value: string | null | undefined): boolean {
  const name = normalizePersonName(value);
  return name.length >= 2 && name.length <= FIELD_LIMITS.name;
}

export function personNameError(value: string | null | undefined): string | null {
  return personNameValid(value) ? null : FIELD_MESSAGES.name;
}

/**
 * Limpia un pegado de monto PYG y devuelve el entero de transporte (solo
 * dígitos). Delega en `normalizarMontoInput` de la librería: entiende grupos de
 * miles (`1.234.567`), no deja letras y en PYG descarta la cola decimal. El
 * campo dibuja el valor con `moneyInputDisplay`.
 */
export function amountInput(value: string): string {
  return normalizarMontoInput(value, "PYG", { integerOnly: true });
}

/**
 * Texto del campo de monto PYG: dígitos con separadores de miles (`8.000.000`),
 * la presentación del `MoneyInput` de la librería. El valor de transporte sigue
 * siendo el entero limpio de `amountInput`.
 */
export function moneyInputDisplay(value: string): string {
  return formatGsInput(value);
}

/** Tope de escritura del campo: el monto máximo permitido entra completo (MoneyInput). */
export function moneyInputMaxLength(limit: number = FIELD_LIMITS.amountGeneral): number {
  return largoMaximoMonto(limit);
}

/** ¿El monto supera el tope del campo? El campo marca `aria-invalid` + `title`. */
export function amountExceeds(value: string, limit: number = FIELD_LIMITS.amountGeneral): boolean {
  return excedeMonto(value, limit);
}

/** Título del campo cuando el monto supera el tope. */
export function amountLimitTitle(limit: number = FIELD_LIMITS.amountGeneral): string {
  return `${FIELD_MESSAGES.amountLimit} (Gs ${new Intl.NumberFormat("es-PY").format(limit)})`;
}

/** Posición del caret tras N dígitos: el formateo no mueve el cursor. */
export function caretAfterDigits(display: string, digits: number): number {
  return caretTrasDigitos(display, digits);
}

/**
 * Monto PYG limpio; `null` si no hay dígitos o si no es un entero seguro.
 * Delega el parseo en `parseGsInput`; las guardas cubren lo que la librería
 * devuelve `0` para vacíos o basura, y el redondeo de enteros fuera de rango.
 */
export function parseAmount(value: string): number | null {
  if (!amountInput(value)) return null;
  const amount = parseGsInput(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function amountValid(value: string, limit: number = FIELD_LIMITS.amountGeneral): boolean {
  const amount = parseAmount(value);
  return amount !== null && amount >= 0 && amount <= limit;
}

/** Error de monto (mismo mensaje para dato inválido y para el tope). */
export function amountError(value: string, limit: number = FIELD_LIMITS.amountGeneral): string | null {
  const amount = parseAmount(value);
  if (amount === null || amount < 0) return FIELD_MESSAGES.amount;
  if (amount > limit) return FIELD_MESSAGES.amountLimit;
  return null;
}

/**
 * Limpia un porcentaje mientras se tipea con el criterio de `PercentField` de
 * la librería: dígitos y una sola coma decimal (los puntos se vuelven comas),
 * hasta 2 decimales, 3 dígitos enteros (0–100) y 6 caracteres.
 */
export function percentInput(value: string): string {
  return limpiarPercent(value);
}

/** Porcentaje 0–100 con hasta 2 decimales; `null` si no es válido. */
export function parsePercent(value: string): number | null {
  // `percentInput` dibuja con coma (criterio de la librería): acá se vuelve a
  // punto para el cálculo.
  const raw = percentInput(value).replace(",", ".");
  if (!raw || raw === ".") return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return Math.round(percent * 100) / 100;
}

export function percentValid(value: string): boolean {
  return parsePercent(value) !== null;
}

export function percentError(value: string): string | null {
  return parsePercent(value) === null ? FIELD_MESSAGES.percent : null;
}

/** Porcentaje listo para mostrar (es-PY, hasta 2 decimales): `12,5`. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(value);
}

/** Correo normalizado como se guarda: minúsculas y sin espacios externos. */
export function normalizeEmail(value: string): string {
  return (value ?? "").trim().toLowerCase();
}

export function emailValid(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 5 || email.length > FIELD_LIMITS.email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function emailError(value: string): string | null {
  return emailValid(value) ? null : FIELD_MESSAGES.email;
}

/** Serial/IMEI como se guarda: mayúsculas, sin espacios ni separadores. */
export function normalizeSerial(value: string): string {
  return (value ?? "").replace(/[^A-Za-z0-9_-]/g, "").toUpperCase();
}

export function serialValid(value: string): boolean {
  const serial = normalizeSerial(value);
  return serial.length >= 2 && serial.length <= FIELD_LIMITS.serial;
}

export function serialError(value: string): string | null {
  return serialValid(value) ? null : FIELD_MESSAGES.serial;
}

export type ParsedPhone = {
  /** Código de país sin el `+` (default +595). */
  countryCode: string;
  /** Parte local, solo dígitos. */
  national: string;
};

/**
 * Parte un teléfono guardado (`+<código> <dígitos>`) o pegado (`0981 000 000`,
 * `+54 9 11 ...`, `00595 ...`) en código de país y parte local.
 *
 * Delega en `parseTelefono` de la librería; el prefijo internacional `00…` se
 * conserva local porque la librería no lo parte (owncoding-ui#4). El contrato no
 * cambia para los consumidores: `countryCode` sin `+` y `national` solo dígitos.
 */
export function parsePhone(value: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): ParsedPhone {
  const raw = (value ?? "").trim();
  if (!raw.startsWith("+")) {
    const digits = digitsOnly(raw);
    // Código de país: 1–3 dígitos (E.164). Con 4, `00595 …` se partía mal (5959/81000000).
    const zeroPrefixed = digits.match(/^00(\d{1,3})(\d{6,})$/);
    if (zeroPrefixed) return { countryCode: zeroPrefixed[1], national: zeroPrefixed[2] };
  }
  const fallback = digitsOnly(defaultCountry) || DEFAULT_PHONE_COUNTRY;
  const parsed = parseTelefonoReal(raw, `+${fallback}`);
  return { countryCode: digitsOnly(parsed.countryCode) || fallback, national: digitsOnly(parsed.phone) };
}

/** Teléfono listo para guardar: `+<código> <dígitos>`; vacío si no hay número. */
export function normalizePhone(value: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): string {
  const { countryCode, national } = parsePhone(value, defaultCountry);
  const code = digitsOnly(countryCode).slice(0, 4) || digitsOnly(defaultCountry) || DEFAULT_PHONE_COUNTRY;
  if (!national) return "";
  return componerTelefonoReal({ countryCode: `+${code}`, phone: national }) ?? "";
}

/**
 * Valida la parte local según el país: PY móvil 9 dígitos, fijo 8; resto 6–12.
 *
 * Queda local a propósito: `telefonoValido` de la librería acepta solo móviles de
 * Paraguay y rechazaría los fijos que LedBox ya guarda y muestra (owncoding-ui#4).
 */
export function phoneValid(value: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): boolean {
  const { countryCode, national } = parsePhone(value, defaultCountry);
  const digits = digitsOnly(national);
  if (!digits) return false;
  if (digitsOnly(countryCode) === DEFAULT_PHONE_COUNTRY) {
    return /^9\d{8}$/.test(digits) || /^0?[2-8]\d{6,8}$/.test(digits);
  }
  return digits.length >= 6 && digits.length <= 12;
}

export function phoneError(value: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): string | null {
  return phoneValid(value, defaultCountry) ? null : FIELD_MESSAGES.phone;
}

/** Campo obligatorio genérico (un solo mensaje). */
export function requiredError(value: string | null | undefined): string | null {
  return (value ?? "").trim() ? null : FIELD_MESSAGES.required;
}

/**
 * Ciudades del catálogo compartido (issue #48): nombre y departamento, tal como
 * los publica `owncoding-ui`. Es la lista de sugerencias del campo Ciudad; el
 * texto libre se acepta igual y no se valida contra el catálogo.
 */
export const CITY_OPTIONS: ReadonlyArray<{ ciudad: string; departamento: string }> = CIUDADES_PARAGUAY.map((entry) => ({
  ciudad: entry.ciudad,
  departamento: entry.departamento,
}));

/**
 * Departamento de una ciudad del catálogo; `null` si el valor es texto libre o
 * está vacío. La búsqueda de la librería ignora mayúsculas y acentos
 * (`asuncion` → `Asunción`) y devuelve `""` cuando no hay coincidencia (el
 * `.d.ts` publica `null`: owncoding-ui#4), así que acá se normaliza.
 */
export function cityDepartment(value: string | null | undefined): string | null {
  const city = (value ?? "").trim();
  if (!city) return null;
  return departamentoDe(city) || null;
}
