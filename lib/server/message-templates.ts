import { formatDate, formatMoney } from "@/lib/admin-format";
import {
  MESSAGE_TEMPLATE_CATEGORIES,
  type MessageTemplateCategoryValue,
  type MessageTemplateVariable,
  type MessageTemplateVariableKey,
  type MessageTemplateVariableValues,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";

export type { MessageTemplateCategoryValue, MessageTemplateVariable, MessageTemplateVariableKey, MessageTemplateVariableValues };

/**
 * Plantillas de mensajes de WhatsApp (issue #35): **fuente única del render**.
 *
 * Acá viven el catálogo de variables por categoría, el saneo y la validación del
 * cuerpo, y el render que completa `{{...}}` con datos reales. Lo comparten el
 * panel (vista previa con datos de ejemplo y edición) y el API (envío y vista
 * previa con datos reales): nunca hay una segunda forma de sustituir variables.
 *
 * Reglas del contrato:
 * - Una variable fuera del catálogo de la categoría es un error de guardado.
 * - Al renderizar, si falta un dato se lanza `MessageTemplateRenderError` con el
 *   nombre de la variable: el mensaje **nunca** sale con `{{...}}` visibles.
 * - El texto se sanea (fin de línea único, sin controles, sin líneas vacías de
 *   más, sin espacios al final, acotado a 2000 caracteres).
 *
 * Módulo puro (sin `db` ni APIs de Node): el panel lo importa para la vista
 * previa y el servidor para el envío real. Las plantillas de arranque
 * (`DEFAULT_MESSAGE_TEMPLATES`) son las mismas de la migración
 * `202609210020_message_templates` y del seed.
 */

/** Largo máximo del cuerpo (mismo límite del kit de campos de texto largo). */
export const MESSAGE_TEMPLATE_BODY_MAX = 2000;

/** Largo máximo del título de la plantilla. */
export const MESSAGE_TEMPLATE_TITLE_MAX = 120;

/** Paso con el que se ordenan las plantillas nuevas dentro de su categoría. */
export const MESSAGE_TEMPLATE_SORT_STEP = 10;

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const LEFTOVER_BRACES = /\{\{|\}\}/;
// Controles de C0/C1 salvo tabulación y salto de línea (el texto viene de un textarea).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Error de render: falta un dato o el cuerpo no es renderizable. */
export class MessageTemplateRenderError extends Error {
  readonly variable: MessageTemplateVariableKey | null;

  constructor(message: string, variable: MessageTemplateVariableKey | null = null) {
    super(message);
    this.name = "MessageTemplateRenderError";
    this.variable = variable;
  }
}

/** Catálogo de variables: etiqueta, ayuda y valor de ejemplo (datos ficticios). */
const VARIABLE_CATALOG: Record<MessageTemplateVariableKey, MessageTemplateVariable> = {
  cliente: {
    key: "cliente",
    label: "Cliente",
    hint: "Nombre o empresa del cliente del envío.",
    sample: "Cliente de ejemplo",
  },
  empresa: {
    key: "empresa",
    label: "Empresa",
    hint: "Nombre de tu empresa (Configuración › Empresa).",
    sample: "LedBox",
  },
  presupuesto: {
    key: "presupuesto",
    label: "Presupuesto",
    hint: "Título del presupuesto o concepto del cobro.",
    sample: "Stand 6x3 · Lanzamiento",
  },
  monto: {
    key: "monto",
    label: "Monto",
    hint: "Monto del presupuesto o del cobro, en guaraníes.",
    sample: "Gs. 12.500.000",
  },
  saldo: {
    key: "saldo",
    label: "Saldo",
    hint: "Saldo pendiente del presupuesto.",
    sample: "Gs. 4.500.000",
  },
  vencimiento: {
    key: "vencimiento",
    label: "Vencimiento",
    hint: "Fecha de validez del presupuesto o de vencimiento del cobro.",
    sample: "30/09/2026",
  },
  evento: {
    key: "evento",
    label: "Evento",
    hint: "Nombre del evento.",
    sample: "Lanzamiento Samsung",
  },
  fecha: {
    key: "fecha",
    label: "Fecha",
    hint: "Fecha de inicio del evento.",
    sample: "04/10/2026",
  },
  lugar: {
    key: "lugar",
    label: "Lugar",
    hint: "Lugar del evento.",
    sample: "Centro de Convenciones · Asunción",
  },
  link_portal: {
    key: "link_portal",
    label: "Link del portal",
    hint: "Link público del presupuesto; requiere que el link esté generado.",
    sample: "https://clientes.ledbox.online/p/ABCD-EFGH-…",
  },
  vendedor: {
    key: "vendedor",
    label: "Vendedor",
    hint: "Nombre de quien envía el mensaje.",
    sample: "Santiago Rodas",
  },
};

/** Catálogo de variables por categoría: es el contrato de lo que puede usar cada una. */
export const MESSAGE_TEMPLATE_VARIABLES: Record<MessageTemplateCategoryValue, readonly MessageTemplateVariable[]> = {
  budget: [
    VARIABLE_CATALOG.cliente,
    VARIABLE_CATALOG.empresa,
    VARIABLE_CATALOG.presupuesto,
    VARIABLE_CATALOG.monto,
    VARIABLE_CATALOG.saldo,
    VARIABLE_CATALOG.vencimiento,
    VARIABLE_CATALOG.link_portal,
    VARIABLE_CATALOG.vendedor,
  ],
  client: [VARIABLE_CATALOG.cliente, VARIABLE_CATALOG.empresa, VARIABLE_CATALOG.vendedor],
  event: [
    VARIABLE_CATALOG.cliente,
    VARIABLE_CATALOG.empresa,
    VARIABLE_CATALOG.evento,
    VARIABLE_CATALOG.fecha,
    VARIABLE_CATALOG.lugar,
    VARIABLE_CATALOG.vendedor,
  ],
  collection: [
    VARIABLE_CATALOG.cliente,
    VARIABLE_CATALOG.empresa,
    VARIABLE_CATALOG.presupuesto,
    VARIABLE_CATALOG.monto,
    VARIABLE_CATALOG.saldo,
    VARIABLE_CATALOG.vencimiento,
    VARIABLE_CATALOG.link_portal,
    VARIABLE_CATALOG.vendedor,
  ],
  other: Object.values(VARIABLE_CATALOG),
};

/** ¿La categoría es una de las del enum del schema? (valida lo que llega del API). */
export function isMessageTemplateCategory(value: unknown): value is MessageTemplateCategoryValue {
  return typeof value === "string" && (MESSAGE_TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

/** Variables de una categoría, indexadas por clave (para validar el cuerpo). */
export function messageTemplateVariablesOf(category: MessageTemplateCategoryValue): readonly MessageTemplateVariable[] {
  return MESSAGE_TEMPLATE_VARIABLES[category];
}

/**
 * Saneo canónico del cuerpo: fin de línea único, sin controles, `{{ Clave }}` →
 * `{{clave}}`, sin espacios al final de cada línea, sin líneas vacías de más y
 * acotado a 2000 caracteres. Es la única forma de normalizar el texto.
 */
export function sanitizeMessageTemplateBody(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(VARIABLE_PATTERN, (_, key: string) => `{{${key.toLowerCase()}}}`)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")
    .slice(0, MESSAGE_TEMPLATE_BODY_MAX);
}

/** Saneo del texto ya renderizado (sin tocar las variables, que a esta altura no existen). */
function sanitizeRenderedText(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")
    .slice(0, MESSAGE_TEMPLATE_BODY_MAX + 1200);
}

/** Claves de variable que aparecen en el cuerpo, sin repetir y en orden de aparición. */
export function messageTemplateVariableKeys(body: string): string[] {
  const keys: string[] = [];
  for (const match of String(body ?? "").matchAll(VARIABLE_PATTERN)) {
    const key = match[1].toLowerCase();
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Valida el cuerpo contra el catálogo de la categoría (lo comparten alta y vista previa). */
function validateMessageTemplateBody(body: string, category: MessageTemplateCategoryValue): string | null {
  const text = String(body ?? "").trim();
  if (!text) return "El mensaje no puede estar vacío.";
  if (text.length > MESSAGE_TEMPLATE_BODY_MAX) {
    return `El mensaje no puede superar los ${MESSAGE_TEMPLATE_BODY_MAX} caracteres.`;
  }
  if (LEFTOVER_BRACES.test(text.replace(VARIABLE_PATTERN, ""))) {
    return "Revisá las llaves: una variable quedó mal escrita (el formato es {{variable}}).";
  }
  const allowed = new Set(messageTemplateVariablesOf(category).map((variable) => variable.key));
  const unknown = messageTemplateVariableKeys(text).filter((key) => !allowed.has(key as MessageTemplateVariableKey));
  if (unknown.length > 0) {
    return `La variable «{{${unknown[0]}}}» no existe en esta categoría.`;
  }
  return null;
}

/**
 * Valida título y cuerpo contra el catálogo de la categoría. Devuelve el error
 * legible o `null` si está listo para guardar. El API revalida siempre.
 */
export function validateMessageTemplate(input: {
  title: string;
  body: string;
  category: MessageTemplateCategoryValue;
}): string | null {
  const title = String(input.title ?? "").trim();
  if (title.length < 2) return "El título es obligatorio (mínimo 2 caracteres).";
  if (title.length > MESSAGE_TEMPLATE_TITLE_MAX) {
    return `El título no puede superar los ${MESSAGE_TEMPLATE_TITLE_MAX} caracteres.`;
  }
  return validateMessageTemplateBody(input.body, input.category);
}

/** Datos de ejemplo de una categoría (vista previa del panel, sin datos reales). */
export function sampleMessageVariables(category: MessageTemplateCategoryValue): MessageTemplateVariableValues {
  const values: MessageTemplateVariableValues = {};
  for (const variable of messageTemplateVariablesOf(category)) values[variable.key] = variable.sample;
  return values;
}

/**
 * Render único: reemplaza cada `{{clave}}` con su valor y falla claro si falta
 * un dato o si el cuerpo quedó con llaves sueltas. Nunca devuelve `{{...}}`.
 */
export function renderMessageTemplate(body: string, values: MessageTemplateVariableValues): string {
  const source = sanitizeMessageTemplateBody(body);
  const missing: string[] = [];
  const rendered = source.replace(VARIABLE_PATTERN, (_, rawKey: string) => {
    const key = rawKey.toLowerCase() as MessageTemplateVariableKey;
    const value = values[key];
    if (value === null || value === undefined || String(value).trim() === "") {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return String(value).trim();
  });
  if (missing.length > 0) {
    const variable = missing[0] as MessageTemplateVariableKey;
    const label = VARIABLE_CATALOG[variable]?.label ?? variable;
    throw new MessageTemplateRenderError(`Falta el dato «${label}» ({{${variable}}}) para completar el mensaje.`, variable);
  }
  if (LEFTOVER_BRACES.test(source.replace(VARIABLE_PATTERN, ""))) {
    throw new MessageTemplateRenderError("El mensaje tiene una variable mal escrita (el formato es {{variable}}).");
  }
  return sanitizeRenderedText(rendered);
}

/** Render de la vista previa con datos de ejemplo; nunca lanza (valida la categoría primero). */
export function previewMessageTemplate(
  body: string,
  category: MessageTemplateCategoryValue,
): { ok: true; text: string } | { ok: false; error: string } {
  const error = validateMessageTemplateBody(body, category);
  if (error) return { ok: false, error };
  try {
    return { ok: true, text: renderMessageTemplate(body, sampleMessageVariables(category)) };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "No se pudo previsualizar el mensaje." };
  }
}

// ── Datos reales por contexto ────────────────────────────────────────────────
// Cada constructor arma solo las variables de su catálogo con datos ya
// resueltos por el API (nada de consultas acá: el módulo es puro).

/** Datos mínimos de una empresa para las variables `empresa` y `vendedor`. */
export type MessageTemplateSender = { organizationName: string; sellerName: string };

export type MessageTemplateClient = { name: string; company?: string | null };

/** Etiqueta del contacto para el mensaje: empresa si hay, si no el nombre. */
function clientDisplayName(client: MessageTemplateClient): string {
  return client.company?.trim() || client.name;
}

export type BudgetMessageData = MessageTemplateSender & {
  client: MessageTemplateClient;
  budgetTitle: string;
  total: number;
  balance: number;
  validUntil: string | Date | null;
  portalToken: string | null;
};

/** Variables de un presupuesto: total, saldo, validez y link del portal. */
export function budgetMessageValues(data: BudgetMessageData): MessageTemplateVariableValues {
  return {
    cliente: clientDisplayName(data.client),
    empresa: data.organizationName,
    presupuesto: data.budgetTitle,
    monto: formatMoney(data.total),
    saldo: formatMoney(data.balance),
    vencimiento: data.validUntil ? formatDate(data.validUntil) : null,
    link_portal: data.portalToken ? portalBudgetUrl(data.portalToken) : null,
    vendedor: data.sellerName,
  };
}

export type EventMessageData = MessageTemplateSender & {
  client: MessageTemplateClient;
  eventName: string;
  startsAt: string | Date | null;
  location: string | null;
};

/** Variables de un evento: nombre, fecha y lugar. */
export function eventMessageValues(data: EventMessageData): MessageTemplateVariableValues {
  return {
    cliente: clientDisplayName(data.client),
    empresa: data.organizationName,
    evento: data.eventName,
    fecha: data.startsAt ? formatDate(data.startsAt) : null,
    lugar: data.location,
    vendedor: data.sellerName,
  };
}

/** Variables de un cliente: solo identidad y empresa. */
export function clientMessageValues(data: MessageTemplateSender & { client: MessageTemplateClient }): MessageTemplateVariableValues {
  return {
    cliente: clientDisplayName(data.client),
    empresa: data.organizationName,
    vendedor: data.sellerName,
  };
}

export type CollectionMessageData = MessageTemplateSender & {
  client: MessageTemplateClient;
  budgetTitle: string | null;
  amount: number;
  balance: number;
  dueAt: string | Date | null;
  portalToken: string | null;
};

/** Variables de una cobranza: monto, saldo, vencimiento y link del portal. */
export function collectionMessageValues(data: CollectionMessageData): MessageTemplateVariableValues {
  return {
    cliente: clientDisplayName(data.client),
    empresa: data.organizationName,
    presupuesto: data.budgetTitle ?? "cuota pendiente",
    monto: formatMoney(data.amount),
    saldo: formatMoney(data.balance),
    vencimiento: data.dueAt ? formatDate(data.dueAt) : null,
    link_portal: data.portalToken ? portalBudgetUrl(data.portalToken) : null,
    vendedor: data.sellerName,
  };
}

// ── Plantillas de arranque ───────────────────────────────────────────────────

export type DefaultMessageTemplate = {
  /** Clave estable del id de la provisión (`<orgId>_tpl_<key>`). */
  key: string;
  category: MessageTemplateCategoryValue;
  title: string;
  body: string;
  sortOrder: number;
};

/**
 * Plantillas útiles de LedBox para las empresas que todavía no tienen ninguna.
 * Misma lista que la provisión de arranque de la migración
 * `202609210020_message_templates` y del seed: si cambia, actualizá las tres.
 */
export const DEFAULT_MESSAGE_TEMPLATES: readonly DefaultMessageTemplate[] = [
  {
    key: "budget_presupuesto_enviado",
    category: "budget",
    title: "Presupuesto enviado",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: te compartimos el presupuesto «{{presupuesto}}» de {{empresa}}.",
      "",
      "• Total: {{monto}}",
      "• Validez: hasta el {{vencimiento}}",
      "• Detalle y aprobación en el portal: {{link_portal}}",
      "",
      "Cualquier consulta quedo a disposición.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "budget_seguimiento",
    category: "budget",
    title: "Seguimiento de presupuesto",
    sortOrder: 20,
    body: [
      "Hola {{cliente}}: ¿cómo estás? Te escribo de {{empresa}} para saber si pudiste revisar el presupuesto «{{presupuesto}}» por {{monto}}.",
      "",
      "Si querés, ajustamos ítems, fechas o forma de pago.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "client_bienvenida",
    category: "client",
    title: "Bienvenida a cliente nuevo",
    sortOrder: 10,
    body: "Hola {{cliente}}: ¡gracias por elegir a {{empresa}}! Soy {{vendedor}} y quedo a disposición para lo que necesites.",
  },
  {
    key: "client_factura",
    category: "client",
    title: "Datos para factura",
    sortOrder: 20,
    body: [
      "Hola {{cliente}}: para dejar lista la factura necesitamos tu RUC o cédula y la razón social. Podés respondernos por acá.",
      "{{vendedor}} · {{empresa}}",
    ].join("\n"),
  },
  {
    key: "event_confirmado",
    category: "event",
    title: "Evento confirmado",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: te confirmamos el evento «{{evento}}» de {{empresa}}.",
      "",
      "• Fecha: {{fecha}}",
      "• Lugar: {{lugar}}",
      "",
      "Nos vemos ahí.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "event_recordatorio",
    category: "event",
    title: "Recordatorio de evento",
    sortOrder: 20,
    body: [
      "Hola {{cliente}}: te recordamos que «{{evento}}» es el {{fecha}} en {{lugar}}. Nuestro equipo llega con antelación para el montaje.",
      "",
      "¡Nos vemos!",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "event_agradecimiento",
    category: "event",
    title: "Agradecimiento post-evento",
    sortOrder: 30,
    body: [
      "Hola {{cliente}}: ¡gracias por confiar en {{empresa}} para «{{evento}}»! Fue un gusto acompañarlos.",
      "",
      "Para tu próximo evento, escribinos.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "collection_recordatorio",
    category: "collection",
    title: "Recordatorio de pago",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: te recordamos el pago pendiente con {{empresa}}.",
      "",
      "• Monto: {{monto}}",
      "• Vencimiento: {{vencimiento}}",
      "• Presupuesto: {{presupuesto}}",
      "",
      "Si ya abonaste, ignorá este mensaje.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "collection_recordatorio_link",
    category: "collection",
    title: "Recordatorio de pago con link",
    sortOrder: 20,
    body: [
      "Hola {{cliente}}: te recordamos el pago pendiente de «{{presupuesto}}».",
      "",
      "• Monto: {{monto}}",
      "• Saldo del presupuesto: {{saldo}}",
      "• Vencimiento: {{vencimiento}}",
      "",
      "Podés ver el detalle y los datos de pago en el portal: {{link_portal}}",
      "",
      "Si ya abonaste, ignorá este mensaje.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    key: "collection_pago_recibido",
    category: "collection",
    title: "Pago recibido",
    sortOrder: 30,
    body: [
      "Hola {{cliente}}: ¡gracias! Registramos tu pago de {{monto}} correspondiente a «{{presupuesto}}». Cualquier duda quedo a disposición.",
      "{{vendedor}} · {{empresa}}",
    ].join("\n"),
  },
  {
    key: "other_general",
    category: "other",
    title: "Mensaje general",
    sortOrder: 10,
    body: ["Hola {{cliente}}: te escribimos de {{empresa}}. Contanos en qué te podemos ayudar.", "{{vendedor}}"].join("\n"),
  },
];
