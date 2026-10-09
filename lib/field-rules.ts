/**
 * Reglas puras de campos del panel (fuente única, testeable).
 *
 * Acá viven la normalización y la validación de teléfonos, correos, seriales,
 * montos PYG, porcentajes y la ayuda de ciudad. La UI dibuja el formato y el API
 * revalida siempre; el front solo ayuda. Un solo mensaje de error por regla.
 *
 * Adopción de `owncoding-ui` (issues #48, #49, #99 y #105): el teléfono y el
 * monto PYG delegan en la librería compartida (`parseTelefono`,
 * `componerTelefono`, `parseGsInput`, `normalizarMontoInput`) y el catálogo de
 * ciudades sale de `CIUDADES_PARAGUAY` + `departamentoDe`. Todo lo puro entra
 * por el subcamino **`owncoding-ui/utils`** (JS sin `"use client"`, el destino
 * de los route handlers y componentes de servidor; Tanda 1 del plan #100). El
 * campo de monto del panel envuelve el `MoneyInput` de la librería
 * (`components/admin/AdminFields.tsx`); los utils de acá quedan para el resto
 * de los consumidores (el descuento del portal). La validación de teléfono y
 * su mensaje quedan locales a propósito: la librería es solo-móvil para
 * Paraguay y rechazaría los fijos que LedBox ya acepta y guarda
 * (owncoding-ui#4).
 */

import {
  CIUDADES_PARAGUAY,
  RUC_RE,
  caretTrasDigitos,
  componerTelefono,
  departamentoDe,
  esRuc,
  excedeMonto,
  extraerRuc,
  largoMaximoMonto,
  limpiarTaxId,
  normalizarMontoInput,
  parseGsInput,
  parseTelefono,
} from "owncoding-ui/utils";
// v0.67.1 sigue sin exportar limpiarPercent por /utils. El root es "use client":
// no puede ejecutar reglas desde API/SSR. La normalización pura vive aquí hasta
// que upstream exponga el helper, con equivalencia testeada frente al runtime.

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
  /** SKU de un ítem de inventario (issue #131). */
  sku: 60,
  /** Imagen de un ítem de inventario: ruta interna o URL http(s). */
  image: 400,
  /** Código de unidad de inventario (issue #112). */
  unitCode: 20,
  /** Monto general (compras, anticipos, cobros). */
  amountGeneral: 10_000_000_000,
  /** Monto de ventas: presupuestos y precios unitarios. */
  amountSales: 99_000_000_000,
  /** Prisma Int / PostgreSQL INT4. La entrada se conserva; el campo avisa. */
  amountStorage: 2_147_483_647,
} as const;

/** Código de país por defecto de los teléfonos (+595 Paraguay). */
export const DEFAULT_PHONE_COUNTRY = "595";

/** Mensaje único de cada regla (se muestra tal cual en el campo). */
export const FIELD_MESSAGES = {
  phone: "Ingresá un teléfono válido con código de país.",
  email: "Ingresá un correo válido.",
  serial: "El serial solo admite letras, números, guiones y guiones bajos.",
  sku: "El SKU solo admite letras, números, espacios, puntos y guiones (2 a 60).",
  image: "Usá una ruta interna (/assets/…) o una URL http(s) válida.",
  price: "Ingresá un precio válido en guaraníes (hasta Gs 10.000.000.000).",
  priceDays: "Ingresá los días de la regla (0 a 3.650).",
  unitCode: "El código solo admite letras, números, guiones y guiones bajos (2 a 20).",
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
  const digits = amountInput(value);
  // BigInt evita redondear un pegado fuera de rango antes de mostrar el error.
  return digits ? new Intl.NumberFormat("es-PY").format(BigInt(digits)) : "";
}

/** Tope de escritura del campo: el monto máximo permitido entra completo (MoneyInput). */
export function moneyInputMaxLength(limit: number = FIELD_LIMITS.amountGeneral): number {
  return largoMaximoMonto(limit);
}

/** ¿El monto supera el tope del campo? El campo marca `aria-invalid` + `title`. */
export function amountExceeds(value: string, limit: number = FIELD_LIMITS.amountGeneral): boolean {
  return excedeMonto(value, limit);
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
  const [integer = "", ...decimal] = String(value ?? "").replace(/\./g, ",").replace(/[^\d,]/g, "").split(",");
  const digits = integer.slice(0, 3);
  return decimal.length ? `${digits},${decimal.join("").slice(0, 2)}`.slice(0, 6) : digits.slice(0, 6);
}

/**
 * RUC / C.I. mientras se tipea: dígitos con un guion opcional antes del
 * verificador (`80012345-6`). Se apoya en `limpiarTaxId` de la librería (la
 * limpieza genérica de identificaciones) y cierra el formato paraguayo: sin
 * letras, sin puntos, un solo guion y nunca al principio. No valida: eso queda
 * para el API, como en el resto de los campos (issue #101).
 */
export function rucInput(value: string, maxLength = 20): string {
  const limpio = limpiarTaxId(value, maxLength).replace(/[^0-9-]/g, "").replace(/^-+/, "");
  const [cuerpo = "", ...cola] = limpio.split("-");
  if (!cola.length) return cuerpo;
  const verificador = cola.join("").slice(0, 1);
  // El guion recién tipeado se conserva para poder escribir el verificador.
  return verificador ? `${cuerpo}-${verificador}` : `${cuerpo}-`;
}

/**
 * RUC del documento como se guarda (Tanda 1 del plan #100): delega en
 * `extraerRuc` de `owncoding-ui/utils` y, si el texto no trae ningún RUC con el
 * patrón paraguayo (`80012345-6`), devuelve el valor tal cual para no perder el
 * dato (C.I. u otro documento). Se usa en los bordes de escritura del API, no
 * en la máscara del campo (`rucInput`).
 */
export function rucDocument(value: unknown, maxLength = 30): string | null {
  if (value === null || value === undefined) return null;
  const texto = String(value).trim();
  if (!texto) return null;
  const ruc = extraerRuc(texto);
  return (ruc || texto).slice(0, maxLength);
}

/**
 * ¿El valor es un RUC paraguayo con dígito verificador? (`esRuc` de la
 * librería). La validación es suave: los formularios avisan, no bloquean
 * (issue #104, RucField).
 */
export function rucValid(value: string | null | undefined): boolean {
  return esRuc(String(value ?? ""));
}

/** Patrón del RUC paraguayo (`80012345-6`) de la librería, reexportado para las reglas del panel. */
export { RUC_RE };

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

/**
 * Imagen de un ítem de inventario (issue #86): ruta interna (`/assets/…`) o URL
 * http(s), recortada y sin HTML. El campo es opcional; vacío no es error.
 */
export function normalizeInventoryImage(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** ¿Imagen válida? Ruta interna `/assets/…` o URL http(s), sin HTML ni espacios y dentro del tope. */
export function inventoryImageValid(value: string | null | undefined): boolean {
  const image = normalizeInventoryImage(value);
  if (!image || image.length > FIELD_LIMITS.image) return false;
  if (/[<>"'`\\]/.test(image) || /[\s\u0000-\u001f\u007f]/.test(image)) return false;
  if (image.startsWith("/assets/")) return true;
  try {
    const url = new URL(image);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Error de la imagen: `null` también cuando viene vacía (el campo es opcional). */
export function inventoryImageError(value: string | null | undefined): string | null {
  const image = normalizeInventoryImage(value);
  if (!image) return null;
  return inventoryImageValid(image) ? null : FIELD_MESSAGES.image;
}

/**
 * SKU del ítem (issue #131): opcional y corto, legible a mano
 * (`LED-P3-500`, `P·01`). Vacío no es error; el API revalida siempre.
 */
export function normalizeInventorySku(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function inventorySkuValid(value: string | null | undefined): boolean {
  return /^[A-Za-z0-9 ._·-]{2,60}$/.test(normalizeInventorySku(value));
}

/** Error del SKU: `null` también cuando viene vacío (el campo es opcional). */
export function inventorySkuError(value: string | null | undefined): string | null {
  const sku = normalizeInventorySku(value);
  if (!sku) return null;
  return inventorySkuValid(sku) ? null : FIELD_MESSAGES.sku;
}

/**
 * Precios de venta del inventario (issues #90 y #110): en guaraníes enteros,
 * 0 = sin cargar. El tope es el del `MoneyInput` (10.000 millones).
 */
export const INVENTORY_PRICE_LIMIT = FIELD_LIMITS.amountGeneral;

/** Tope de los días de las reglas «desde X días» (10 años alcanza y evita desbordar el Int). */
export const INVENTORY_PRICE_DAYS_MAX = 3650;

/**
 * Unidades físicas del inventario (issue #112): el código es legible, único por
 * empresa y editable. El prefijo sale del nombre del ítem (`KIO-01`); mismo
 * criterio que el backfill de la migración `202610010004_inventory_units`.
 */
export function inventoryUnitPrefix(name: string | null | undefined): string {
  const letters = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
  return letters.slice(0, 3).toUpperCase() || "UNI";
}

/** Código de unidad como se guarda: mayúsculas, sin espacios ni símbolos raros. */
export function normalizeInventoryUnitCode(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, FIELD_LIMITS.unitCode);
}

export function inventoryUnitCodeValid(value: string | null | undefined): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{1,19}$/.test((value ?? "").trim().toUpperCase());
}

export function inventoryUnitCodeError(value: string | null | undefined): string | null {
  return inventoryUnitCodeValid(value) ? null : FIELD_MESSAGES.unitCode;
}

/**
 * Precio de venta validado: entero ≥ 0 dentro del tope. `null` cuando no viene
 * valor (queda en 0 / no cambia) y `false` cuando es inválido (texto, HTML,
 * negativo, decimal o fuera del tope).
 */
export function inventoryPriceValue(raw: unknown): number | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 && raw <= INVENTORY_PRICE_LIMIT ? raw : false;
  }
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!/^\d+$/.test(clean)) return false;
    const price = Number(clean);
    return price <= INVENTORY_PRICE_LIMIT ? price : false;
  }
  return false;
}

/** Días de una regla «desde X días»: entero entre 0 y `INVENTORY_PRICE_DAYS_MAX`. */
export function inventoryPriceDaysValue(raw: unknown): number | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 && raw <= INVENTORY_PRICE_DAYS_MAX ? raw : false;
  }
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!/^\d+$/.test(clean)) return false;
    const days = Number(clean);
    return days <= INVENTORY_PRICE_DAYS_MAX ? days : false;
  }
  return false;
}

/**
 * Los siete campos de precios del ítem (issues #90 y #110), validados de una
 * vez: cada frente tiene su precio normal y su regla «desde X días», más el
 * piso. `null` = sin valor (no cambia / queda en 0); error = inválido.
 */
export type InventoryPriceValues = {
  listPrice: number | null;
  listFromDays: number | null;
  listFromPrice: number | null;
  wholesalePrice: number | null;
  wholesaleFromDays: number | null;
  wholesaleFromPrice: number | null;
  minimumPrice: number | null;
};

export type InventoryPriceReadResult =
  | { ok: true; values: InventoryPriceValues }
  | { ok: false; error: string };

export function readInventoryPriceValues(body: Record<string, unknown>): InventoryPriceReadResult {
  const values = {} as InventoryPriceValues;
  const priceFields = ["listPrice", "listFromPrice", "wholesalePrice", "wholesaleFromPrice", "minimumPrice"] as const;
  const daysFields = ["listFromDays", "wholesaleFromDays"] as const;
  for (const field of priceFields) {
    const value = inventoryPriceValue(body[field]);
    if (value === false) return { ok: false, error: FIELD_MESSAGES.price };
    values[field] = value;
  }
  for (const field of daysFields) {
    const value = inventoryPriceDaysValue(body[field]);
    if (value === false) return { ok: false, error: FIELD_MESSAGES.priceDays };
    values[field] = value;
  }
  return { ok: true, values };
}

/**
 * Aviso de coherencia de los precios (issues #90 y #110), sin bloquear el
 * guardado:
 *
 * - entre frentes: con lista cargada, el mayorista o el mínimo no deberían
 *   superarla;
 * - dentro de cada frente: el «desde X días» es un beneficio por duración, así
 *   que no debería superar al precio normal de ese mismo frente.
 *
 * Devuelve los avisos unidos o `null` si están en orden.
 */
export function inventoryPriceWarning(prices: {
  listPrice: number;
  listFromPrice: number;
  wholesalePrice: number;
  wholesaleFromPrice: number;
  minimumPrice: number;
}): string | null {
  const warnings: string[] = [];
  if (prices.listPrice > 0 && prices.wholesalePrice > prices.listPrice) {
    warnings.push("El precio mayorista supera al de lista.");
  }
  if (prices.listPrice > 0 && prices.minimumPrice > prices.listPrice) {
    warnings.push("El precio mínimo supera al de lista.");
  }
  if (prices.listPrice > 0 && prices.listFromPrice > prices.listPrice) {
    warnings.push("El precio final desde esos días supera al normal.");
  }
  if (prices.wholesalePrice > 0 && prices.wholesaleFromPrice > prices.wholesalePrice) {
    warnings.push("El precio mayorista desde esos días supera al normal.");
  }
  return warnings.length > 0 ? warnings.join(" ") : null;
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
