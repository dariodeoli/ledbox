import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import { formatDate, formatMoney, formatNumber } from "@/lib/admin-format";
import type { MessageTemplateCategoryValue } from "@/lib/admin-types";
import { DEMO_PLAN_CODE } from "@/lib/plan-rules";
import { db } from "./db";
import { hashPassword } from "./auth";
import { DAY_MS, clientLabel, dayKeyOf, dayStart, shiftDayKey } from "./notifications";

/**
 * Demo pública (issue #15): organización «LedBox Demo» con datos simulados.
 *
 * El alta es **idempotente**: cada fila tiene un id determinístico y se escribe
 * con `upsert`, así que entrar a la demo las veces que sea no duplica nada.
 *
 * **Ventana móvil (±6 meses)**: los eventos son ferias y expos reales de
 * Paraguay con su mes/día reales; el año se proyecta a la ocurrencia más
 * cercana a HOY, así el dataset siempre cae entre los últimos 6 meses y los
 * próximos 6, sin quedar nunca sin agenda. Cada provisión re-ancla además las
 * fechas relativas (cobros, leads, actividad) a HOY en zona America/Asuncion y
 * **re-deriva los estados por fecha**: lo pasado queda `COMPLETED`, lo que está
 * en curso `IN_PROGRESS`, lo futuro `CONFIRMED` y el borrador `DRAFT`.
 *
 * La demo vive en su propia organización: el tenancy del panel filtra todas las
 * consultas por `organizationId`, así que ninguna sesión demo puede leer ni
 * escribir datos de otra empresa. Además la organización demo es de solo
 * lectura por contrato (ver `lib/server/tenancy.ts`).
 *
 * Los datos son ficticios: las marcas y los eventos son referencias reales del
 * mercado paraguayo usadas como clientes simulados, con contactos inventados.
 *
 * La demo recorre el producto completo (issue #32): además de la agenda, los
 * presupuestos, el inventario y las finanzas, siembra **tesorería por cuentas**
 * (saldos derivados de movimientos reales, con una transferencia de cheque ya
 * hecha), **gastos** (dos «A definir» sin proyecto), **pagos esperados**
 * (comprobante en revisión, vencido sin comprobante y confirmado), **correos**
 * (`MailLog`, incluido un fallo con su motivo), **invitaciones al equipo**
 * (pendiente y aceptada), **plantillas de mensajes de WhatsApp** (repartidas por
 * categoría, con las variables del catálogo) e **identidad** (logos claro/oscuro
 * de la empresa y avatares del equipo, generados como PNG en el momento del
 * alta). El usuario demo no tiene PIN ni auto-bloqueo: la demo no se bloquea sola.
 */

export const DEMO_ORGANIZATION_ID = "org_demo";
export const DEMO_ORGANIZATION_SLUG = "demo";
export const DEMO_ORGANIZATION_NAME = "LedBox Demo";

export const DEMO_USER_ID = "demo_visitor";
export const DEMO_USER_EMAIL = "demo@ledbox.online";
export const DEMO_USER_NAME = "Visitante demo";

export const DEMO_MEMBERSHIP_ID = "demo_visitor_membership";

/**
 * Datos de pago de la empresa demo (issue #14): los datos reales de LedBox
 * autorizados por Dario, para que el portal y la hoja imprimible muestren el
 * circuito completo. Se publican solo en presupuestos aprobados, igual que en
 * el panel.
 */
export const DEMO_PAYMENT_DETAILS = {
  bank: "Ueno Bank",
  holder: "Santiago Javier Rodas",
  ruc: null,
  account: "6191649354",
  alias: "c.i +595 982 029217",
} as const;

/** ¿La organización ya tiene datos de pago cargados? (no se pisan si existen). */
function hasPaymentDetails(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

/** ¿La empresa activa es la demo? (fuente única del slug en toda la app) */
export function isDemoOrganizationSlug(slug: string | null | undefined): boolean {
  return slug === DEMO_ORGANIZATION_SLUG;
}

/** ¿La organización activa de la sesión es la demo? (misma regla en toda la app) */
export async function isDemoOrganizationId(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return isDemoOrganizationSlug(organization?.slug);
}

export type DemoSessionTarget = {
  organizationId: string;
  user: { id: string; name: string; email: string; role: "VIEWER" };
};

// ── Fechas: zona America/Asuncion y ventana móvil ────────────────────────────

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 00:00 de Asunción de hoy. */
function todayBase(): Date {
  return dayStart(dayKeyOf(new Date()));
}

/** Instante a `days` días de la base (`0` = hoy) a las `hour:minute` de Asunción. */
function at(base: Date, days: number, hour: number, minute = 0): Date {
  return new Date(base.getTime() + days * DAY_MS + (hour * 60 + minute) * 60_000);
}

/**
 * Día de Asunción de `date` + `days`, a las `hour:minute`. Se usa cuando la base
 * no es la medianoche (setup, inicio o desmontaje de un evento): fija la hora en
 * el día pedido en vez de sumar horas sobre la hora de la base.
 */
function atDay(date: Date, days: number, hour: number, minute = 0): Date {
  return at(dayStart(dayKeyOf(date)), days, hour, minute);
}

/** Suma horas exactas a un instante. */
function plusHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Instante pasado garantizado (si la hora elegida todavía no llegó, cae una hora atrás). */
function pastInstant(candidate: Date, now: Date): Date {
  return candidate.getTime() <= now.getTime() ? candidate : new Date(now.getTime() - 60 * 60 * 1000);
}

/** Instante de Asunción de una fecha calendario concreta. */
function asuncionAt(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(dayStart(`${year}-${pad(month)}-${pad(day)}`).getTime() + (hour * 60 + minute) * 60_000);
}

/**
 * Ventana móvil: ocurrencia más cercana a `now` de un evento anual (mes/día
 * reales). Como la ventana es de ±6 meses, el candidato más cercano siempre cae
 * adentro; al correr los días la fecha se corre sola con el año siguiente.
 */
function nearestOccurrence(month: number, day: number, hour: number, now: Date): Date {
  const year = Number(dayKeyOf(now).slice(0, 4));
  let best: Date | null = null;
  for (const candidateYear of [year - 1, year, year + 1, year + 2]) {
    const candidate = asuncionAt(candidateYear, month, day, hour);
    const distance = Math.abs(candidate.getTime() - now.getTime());
    // `<=` prefiere la ocurrencia futura cuando el empate es exacto (la demo sigue viva).
    if (!best || distance <= Math.abs(best.getTime() - now.getTime())) best = candidate;
  }
  return best as Date;
}

/** Fecha dentro del mes en curso: si el desplazamiento se va al mes anterior, cae hoy. */
function withinMonth(base: Date, daysAgo: number, hour: number, minute = 0): Date {
  const dayOfMonth = Number(dayKeyOf(base).slice(8, 10));
  return dayOfMonth > daysAgo ? at(base, -daysAgo, hour, minute) : at(base, 0, hour, minute);
}

/** Copia de un `create` sin `id` para el `update` del upsert (misma data, sin duplicar). */
function withoutId<T extends { id: string }>(row: T): Omit<T, "id"> {
  const { id: _id, ...rest } = row;
  return rest;
}

/** Fila del dataset con `id` obligatorio (el alta idempotente lo escribe siempre). */
type Seeded<T extends { id?: unknown }> = Omit<T, "id"> & { id: string };

/** Fecha del dataset como `Date` (Prisma acepta `Date | string`; acá siempre es `Date`). */
function dateOf(value: Date | string | null | undefined, fallback: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return fallback;
}

const DEMO_ORGANIZATION: Prisma.OrganizationUncheckedCreateInput = {
  id: DEMO_ORGANIZATION_ID,
  name: DEMO_ORGANIZATION_NAME,
  slug: DEMO_ORGANIZATION_SLUG,
  active: true,
  paymentDetails: DEMO_PAYMENT_DETAILS,
};

type DemoEventStatus = "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/**
 * Estado por fecha: pasado finalizado, hoy en curso, futuro confirmado. El
 * borrador y el cancelado se declaran (no se derivan de la fecha).
 */
function eventStatusFrom(startsAt: Date, endsAt: Date, now: Date, draft = false, cancelled = false): DemoEventStatus {
  if (cancelled) return "CANCELLED";
  if (draft) return "DRAFT";
  if (endsAt.getTime() < now.getTime()) return "COMPLETED";
  if (startsAt.getTime() > now.getTime()) return "CONFIRMED";
  return "IN_PROGRESS";
}

type DemoAuditActor = { id: string; name: string; email: string };

const ACTORS = {
  sales: { id: "demo_user_valeria", name: "Valeria Ortiz", email: "valeria.ortiz@ledbox.demo" },
  ops: { id: "demo_user_marco", name: "Marco Ferreira", email: "marco.ferreira@ledbox.demo" },
} satisfies Record<string, DemoAuditActor>;

// ── Clientes: marcas que participan de las ferias (contactos inventados) ─────

type DemoClient = {
  id: string;
  type: "FINAL" | "RESELLER";
  /** Persona de contacto (ficticia). */
  name: string;
  /** Marca o empresa (referencia real del mercado paraguayo). */
  company: string;
  email: string;
  phone: string;
  notes: string;
};

const CLIENTS: readonly DemoClient[] = [
  { id: "demo_client_tigo", type: "FINAL", name: "Lucía Fernández", company: "Tigo Paraguay", email: "eventos@tigo.demo", phone: "+595 981 214 500", notes: "Cuenta clave: pabellón propio en la Expo y activaciones en shoppings. Facturación a 30 días." },
  { id: "demo_client_personal", type: "FINAL", name: "Diego Ocampos", company: "Personal", email: "marketing@personal.demo", phone: "+595 983 110 220", notes: "Patrocina congresos y jornadas de negocios; pide streaming y pantalla de sala." },
  { id: "demo_client_claro", type: "FINAL", name: "Sofía Duarte", company: "Claro Paraguay", email: "eventos@claro.demo", phone: "+595 971 330 400", notes: "Feria binacional de Alto Paraná; coordina con la cámara de comercio." },
  { id: "demo_client_samsung", type: "FINAL", name: "Rodrigo Núñez", company: "Samsung Paraguay", email: "retail@samsung.demo", phone: "+595 985 664 100", notes: "Lanzamientos y demo de producto; exige pantallas P3.9 y tótems de consulta." },
  { id: "demo_client_lg", type: "FINAL", name: "Gabriela Sosa", company: "LG Electronics Paraguay", email: "marketing@lg.demo", phone: "+595 991 555 808", notes: "Jornadas de ecommerce y showrooms; contenido vertical para redes." },
  { id: "demo_client_cellshop", type: "FINAL", name: "Marta Benítez", company: "Cellshop", email: "campanas@cellshop.demo", phone: "+595 982 770 310", notes: "Campañas de compras online; showroom con pantalla principal y transmisión." },
  { id: "demo_client_nissei", type: "FINAL", name: "Luis Cáceres", company: "Nissei", email: "eventos@nissei.demo", phone: "+595 984 112 233", notes: "Cyberday y aniversarios de tienda; pide activaciones en atrio." },
  { id: "demo_client_shopping", type: "FINAL", name: "Ana Villalba", company: "Shopping del Sol", email: "marketing@shoppingdelsol.demo", phone: "+595 985 330 774", notes: "Pasarelas y campañas estacionales en el atrio central." },
  { id: "demo_client_paseo", type: "FINAL", name: "Javier Paredes", company: "Paseo La Galería", email: "eventos@paseolagaleria.demo", phone: "+595 981 445 210", notes: "Sede de ferias y congresos; requiere montaje nocturno y desmontaje exprés." },
  { id: "demo_client_itau", type: "FINAL", name: "Carla Núñez", company: "Banco Itaú Paraguay", email: "eventos@itau.demo", phone: "+595 983 220 118", notes: "Banca de inversión y financiación de vehículos; presencia en el salón del automóvil." },
  { id: "demo_client_ueno", type: "FINAL", name: "Roberto Ayala", company: "Ueno Bank", email: "brand@ueno.demo", phone: "+595 971 808 260", notes: "Sponsor de eventos y ferias de inversión; pide tótems interactivos." },
  { id: "demo_client_vision", type: "FINAL", name: "Patricia Giménez", company: "Visión Banco", email: "sucursales@visionbanco.demo", phone: "+595 981 300 700", notes: "Ferias de vivienda: simulador de créditos y pantallas de atención." },
  { id: "demo_client_cocacola", type: "FINAL", name: "Sandra Meza", company: "Coca-Cola Paresa", email: "activaciones@cocacola.demo", phone: "+595 983 991 004", notes: "Festivales y activaciones de verano; botella gigante y escenario de marca." },
  { id: "demo_client_cerveza", type: "FINAL", name: "Marco Ferreira", company: "Cervecería Paraguaya", email: "eventos@cervezaparaguaya.demo", phone: "+595 984 220 118", notes: "Patrocina festivales y activaciones de verano en la Costanera." },
  { id: "demo_client_trebol", type: "FINAL", name: "Gabriela Benítez", company: "Lácteos Trébol", email: "marketing@trebol.demo", phone: "+595 972 664 812", notes: "Stand institucional y degustación en ferias regionales del sur." },
  { id: "demo_client_superseis", type: "FINAL", name: "Rodrigo Meza", company: "Superseis", email: "marketing@superseis.demo", phone: "+595 991 204 118", notes: "Campañas de retail: pantallas en tienda y activaciones de fin de semana." },
  { id: "demo_client_pixel", type: "RESELLER", name: "Diego Ramírez", company: "Agencia Pixel", email: "produccion@agenciapixel.demo", phone: "+595 984 665 220", notes: "Agencia de eventos: alquila equipos para marcas de consumo masivo." },
  { id: "demo_client_puntocreativo", type: "RESELLER", name: "Laura Acosta", company: "Punto Creativo Eventos", email: "cuentas@punktocreativo.demo", phone: "+595 971 909 330", notes: "Revendedor: producción de stands y activaciones para terceros." },
];

const CLIENT_BY_ID = new Map(CLIENTS.map((client) => [client.id, client]));

/**
 * Marca y contacto de cada cliente demo (issue #36): iniciales y color del
 * monograma que se usa como logo, el cargo de la persona encargada y sus links
 * directos. Datos ficticios plausibles: la demo no depende de assets externos
 * (el logo se genera en el proceso) y el WhatsApp solo se completa cuando
 * difiere del teléfono general — si falta, el link usa el teléfono.
 */
type DemoClientProfile = {
  /** Iniciales del monograma del logo (marca). */
  initials: string;
  /** Color de marca del degradé del monograma. */
  accent: Rgba;
  /** Cargo de la persona encargada (el nombre es el contacto del cliente). */
  contactRole: string;
  website: string;
  instagram: string;
  whatsapp?: string;
};

const CLIENT_PROFILES: Record<string, DemoClientProfile> = {
  demo_client_tigo: { initials: "TG", accent: [0, 58, 140, 255], contactRole: "Gerenta de Eventos", website: "https://www.tigo.com.py", instagram: "tigoparaguay", whatsapp: "+595 981 214 511" },
  demo_client_personal: { initials: "PE", accent: [0, 103, 177, 255], contactRole: "Jefe de Marketing", website: "https://www.personal.com.py", instagram: "personalparaguay" },
  demo_client_claro: { initials: "CL", accent: [218, 41, 28, 255], contactRole: "Coordinadora de Eventos", website: "https://www.claro.com.py", instagram: "claropy", whatsapp: "+595 971 330 411" },
  demo_client_samsung: { initials: "SA", accent: [20, 40, 160, 255], contactRole: "Gerente de Retail", website: "https://www.samsung.com/py", instagram: "samsungparaguay" },
  demo_client_lg: { initials: "LG", accent: [165, 0, 52, 255], contactRole: "Jefa de Marketing", website: "https://www.lg.com/py", instagram: "lgparaguay" },
  demo_client_cellshop: { initials: "CS", accent: [220, 40, 60, 255], contactRole: "Coordinadora de Campañas", website: "https://www.cellshop.com.py", instagram: "cellshoppy" },
  demo_client_nissei: { initials: "NI", accent: [0, 90, 170, 255], contactRole: "Jefe de Eventos", website: "https://www.nissei.com.py", instagram: "nisseipy" },
  demo_client_shopping: { initials: "SD", accent: [196, 22, 118, 255], contactRole: "Gerenta de Marketing", website: "https://www.shoppingdelsol.com", instagram: "shoppingdelsol" },
  demo_client_paseo: { initials: "PG", accent: [0, 150, 160, 255], contactRole: "Coordinador de Eventos", website: "https://www.paseolagaleria.com.py", instagram: "paseolagaleria" },
  demo_client_itau: { initials: "IT", accent: [236, 104, 44, 255], contactRole: "Gerenta de Eventos", website: "https://www.itau.com.py", instagram: "itauparaguay" },
  demo_client_ueno: { initials: "UE", accent: [150, 200, 0, 255], contactRole: "Brand Manager", website: "https://www.ueno.com.py", instagram: "uenobank", whatsapp: "+595 971 808 261" },
  demo_client_vision: { initials: "VB", accent: [0, 70, 160, 255], contactRole: "Jefa de Sucursales", website: "https://www.visionbanco.com", instagram: "visionbanco" },
  demo_client_cocacola: { initials: "CC", accent: [228, 0, 0, 255], contactRole: "Coordinadora de Activaciones", website: "https://www.cocacola.com.py", instagram: "cocacolapy" },
  demo_client_cerveza: { initials: "CP", accent: [200, 140, 20, 255], contactRole: "Gerente de Eventos", website: "https://www.cervezaparaguaya.com.py", instagram: "cervezaparaguaya", whatsapp: "+595 984 220 119" },
  demo_client_trebol: { initials: "TR", accent: [0, 110, 190, 255], contactRole: "Jefa de Marketing", website: "https://www.trebol.com.py", instagram: "lacteostrebol" },
  demo_client_superseis: { initials: "SU", accent: [0, 140, 70, 255], contactRole: "Gerente de Marketing", website: "https://www.superseis.com.py", instagram: "superseis" },
  demo_client_pixel: { initials: "AP", accent: [120, 60, 200, 255], contactRole: "Director de Producción", website: "https://www.agenciapixel.com.py", instagram: "agenciapixelpy" },
  demo_client_puntocreativo: { initials: "PC", accent: [230, 120, 20, 255], contactRole: "Gerenta de Cuentas", website: "https://www.puntocreativo.com.py", instagram: "puntocreativo" },
};

/** Correo directo del encargado: nombre.apellido en el dominio del cliente. */
function contactEmailOf(client: DemoClient): string {
  const domain = client.email.split("@")[1] ?? "empresa.demo";
  const slug = client.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || "contacto"}@${domain}`;
}

/** Contacto del cliente de un evento (para las aprobaciones del portal). */
function clientContact(clientId: string): DemoAuditActor {
  const client = CLIENT_BY_ID.get(clientId);
  return { id: "portal", name: client?.name ?? "Cliente (portal)", email: client?.email ?? "" };
}

// ── Eventos reales de Paraguay (mes/día reales; el año se proyecta a la ventana) ──
//
// Fechas confirmadas con fuentes públicas (relevamiento del 21-sep-2026):
// Expo Paraguay ARP (11–26 jul, 43.ª edición), Expo eCommerce CAPACE (21 may),
// eCommerce Day (24 sep, Auditorio del BCP), Expo Paraguay Brasil (11–13 nov),
// ExpoNegocios (30 sep–1 oct), Expo Real Estate (23–24 jun), CADAM Motor Show
// (30 jul–9 ago), Cyberday CAPACE (3–5 nov), Hot Sale CAPACE (6–8 abr),
// Asunciónico (17–19 mar, Parque Olímpico), Expo Concepción (31 ago–6 sep),
// WRC ueno Rally del Paraguay (27–30 ago, Encarnación), Fintech Iberoamérica
// Summit (6 ago), Expo Capasu (10–11 sep), Expo Hogar (3–4 sep), Expo Itapúa
// (6 ago), Asunción Fashion Week Invierno (27–30 abr) y Resort (7–11 oct),
// Expo Amambay (10–18 oct), Gran Expo Guairá (21 oct–1 nov), Feria Agropecuaria
// San Pedro (11–14 nov), Agroshow Copronar (18–20 nov), Agrodinámica (1–5 dic),
// ChoppFest (7 nov, Colonia Independencia), FITPAR (16–18 oct), Navegistic
// (6–8 oct), Feria Hogar del Chaco (9–11 oct), Exposur Itapúa (3–11 ene),
// Tan Biónica (10 oct, Arena Asunción), Marco Antonio Solís (31 oct, Jockey
// Club), Ed Sheeran (26 nov, La Nueva Olla), Gorillaz (1 dic, Jockey Club).
// Expo Itapúa y Expo Hogar no publicaron fecha 2026: se ubican en su mes
// habitual (ago y sep) de forma plausible.
//
// El cronograma cubre el año hasta el 31-dic-2026 y la ventana móvil (±6
// meses) proyecta los anuales a su ocurrencia más cercana a HOY.

type DemoRealEvent = {
  id: string;
  clientId: string;
  name: string;
  location: string;
  /** Mes y día reales del evento (el año se proyecta a la ventana móvil). */
  month: number;
  day: number;
  /** Días de feria contados desde el inicio (1 = un solo día). */
  days: number;
  startsHour?: number;
  notes: string;
};

const REAL_EVENTS: readonly DemoRealEvent[] = [
  { id: "demo_event_asuncionico", clientId: "demo_client_cocacola", name: "Asunciónico", location: "Parque Olímpico, Asunción", month: 3, day: 17, days: 3, startsHour: 16, notes: "Festival de música: escenario principal, pantallas laterales y activación de marca." },
  { id: "demo_event_hot_sale", clientId: "demo_client_cellshop", name: "Hot Sale Paraguay · showroom", location: "Paseo La Galería, Asunción", month: 4, day: 6, days: 3, notes: "Showroom de la campaña de CAPACE: pantalla de ofertas y transmisión en vivo." },
  { id: "demo_event_afw_invierno", clientId: "demo_client_shopping", name: "Asunción Fashion Week · Invierno", location: "Distrito Perseverancia, Asunción", month: 4, day: 27, days: 4, startsHour: 20, notes: "Pasarela y showroom: pantalla de fondo, iluminación y contenido para redes." },
  { id: "demo_event_expo_ecommerce", clientId: "demo_client_samsung", name: "Expo eCommerce Paraguay", location: "Centro de Convenciones Paseo La Galería, Asunción", month: 5, day: 21, days: 1, notes: "Congreso de comercio electrónico de CAPACE; stand con demo de producto." },
  { id: "demo_event_real_estate", clientId: "demo_client_ueno", name: "Expo Real Estate Paraguay", location: "Centro de Convenciones de la Conmebol, Asunción", month: 6, day: 23, days: 2, notes: "Feria inmobiliaria: pantallas de sala, lanzamientos y tótems de consulta." },
  { id: "demo_event_expo_paraguay", clientId: "demo_client_tigo", name: "Expo Paraguay · ARP", location: "Predio Ferial ARP, Mariano Roque Alonso", month: 7, day: 11, days: 16, notes: "La muestra más grande del país: pabellón de marca, escenario y 16 días de operación." },
  { id: "demo_event_cadam", clientId: "demo_client_itau", name: "CADAM Motor Show", location: "Paseo La Galería (Nivel -3), Asunción", month: 7, day: 30, days: 11, notes: "Salón del automóvil: pantallas por marca, simuladores y financiación." },
  // Agenda confirmada del segundo semestre (issue #32).
  { id: "demo_event_fintech_summit", clientId: "demo_client_ueno", name: "Fintech Iberoamérica Summit", location: "Centro de Convenciones Paseo La Galería, Asunción", month: 8, day: 6, days: 1, notes: "Primera edición del encuentro fintech iberoamericano: pantalla de sala, streaming y tótems." },
  { id: "demo_event_expo_itapua", clientId: "demo_client_trebol", name: "Expo Itapúa", location: "Costanera de Encarnación", month: 8, day: 6, days: 4, notes: "Feria regional del sur: stand institucional, degustación y escenario (fecha habitual, sin anuncio 2026)." },
  { id: "demo_event_wrc_rally", clientId: "demo_client_ueno", name: "WRC ueno Rally del Paraguay", location: "Encarnación (parque de servicio y shakedown)", month: 8, day: 27, days: 4, startsHour: 9, notes: "Fecha mundialista del rally: pantallas de largada simbólica, fan zone y activaciones de marca." },
  { id: "demo_event_expo_concepcion", clientId: "demo_client_claro", name: "Expo Concepción", location: "Campo de Exposiciones Nanawa, Concepción", month: 8, day: 31, days: 7, startsHour: 17, notes: "La fiesta del norte: pabellón de marca, escenario y activaciones durante la semana." },
  { id: "demo_event_expo_hogar", clientId: "demo_client_vision", name: "Expo Hogar", location: "Centro de Convenciones, Asunción", month: 9, day: 3, days: 4, notes: "Feria de vivienda y hogar: simulador de créditos y ambientación de stands (fecha habitual, sin anuncio 2026)." },
  { id: "demo_event_expo_capasu", clientId: "demo_client_superseis", name: "Expo Capasu", location: "Centro de Convenciones de la Conmebol, Asunción", month: 9, day: 10, days: 2, notes: "Feria del retail supermercadista: pantallas de sala, degustaciones y demo de producto." },
  { id: "demo_event_ecommerce_day", clientId: "demo_client_lg", name: "eCommerce Day Paraguay", location: "Auditorio del Banco Central del Paraguay, Asunción", month: 9, day: 24, days: 1, notes: "Jornada de ecommerce con demo de producto y contenido en vivo." },
  { id: "demo_event_exponegocios", clientId: "demo_client_personal", name: "ExpoNegocios", location: "Centro de Eventos Paseo La Galería, Asunción", month: 9, day: 30, days: 2, notes: "Encuentro empresarial: pantalla principal, streaming y networking." },
  { id: "demo_event_navegistic", clientId: "demo_client_itau", name: "Navegistic Intermodal", location: "Centro de Eventos Paseo La Galería, Asunción", month: 10, day: 6, days: 3, startsHour: 9, notes: "Feria de logística y comercio exterior: pantalla de sala y tótems de consulta." },
  { id: "demo_event_afw_resort", clientId: "demo_client_paseo", name: "Asunción Fashion Week · Resort", location: "Distrito Perseverancia, Asunción", month: 10, day: 7, days: 5, startsHour: 20, notes: "Edición Resort: pasarela, contenido vertical y showroom." },
  { id: "demo_event_feria_hogar", clientId: "demo_client_cocacola", name: "Feria Hogar del Chaco", location: "Predio Pioneros del Chaco, Loma Plata", month: 10, day: 9, days: 3, notes: "Feria de hogar y familia en el Chaco: activación de marca, degustación y escenario." },
  { id: "demo_event_tan_bionica", clientId: "demo_client_personal", name: "Tan Biónica · El Regreso", location: "Arena Asunción, Asunción", month: 10, day: 10, days: 1, startsHour: 21, notes: "Show internacional: pantallas de escenario, contenido vertical y activación de marca." },
  { id: "demo_event_expo_amambay", clientId: "demo_client_claro", name: "Expo Amambay", location: "Campo de Exposiciones Marcos Paredes Ramírez, Pedro Juan Caballero", month: 10, day: 10, days: 9, startsHour: 17, notes: "Feria del norte en su 29.ª edición: pabellón de marca, escenario y conectividad." },
  { id: "demo_event_fitpar", clientId: "demo_client_vision", name: "FITPAR · Feria Internacional de Turismo", location: "Centro de Convenciones Mariscal, Asunción", month: 10, day: 16, days: 3, notes: "Feria de turismo: pantallas de destinos, escenario cultural y activación de marca." },
  { id: "demo_event_expo_guaira", clientId: "demo_client_vision", name: "Gran Expo Guairá", location: "Estancia San Jorge, Mbocayaty (Guairá)", month: 10, day: 21, days: 12, startsHour: 17, notes: "La muestra más grande del Guairá: escenario, pantallas y activaciones en el predio." },
  { id: "demo_event_marco_solis", clientId: "demo_client_tigo", name: "Marco Antonio Solís · Tour Gratitud", location: "Jockey Club Paraguayo, Asunción", month: 10, day: 31, days: 1, startsHour: 20, notes: "Show internacional: pantallas laterales, streaming y activación de marca." },
  { id: "demo_event_cyberday", clientId: "demo_client_nissei", name: "Cyberday Paraguay", location: "Paseo La Galería, Asunción", month: 11, day: 3, days: 3, notes: "Campaña de compras online de CAPACE con estudio de transmisión." },
  { id: "demo_event_choppfest", clientId: "demo_client_cerveza", name: "ChoppFest · Club Deportivo Alemán", location: "Colonia Independencia, Guairá", month: 11, day: 7, days: 1, startsHour: 18, notes: "47.ª edición de la fiesta de la cerveza: escenario, pantallas y activación de marca." },
  { id: "demo_event_expo_brasil", clientId: "demo_client_claro", name: "Expo Paraguay Brasil", location: "Centro TASK · PTI, Hernandarias", month: 11, day: 11, days: 3, notes: "Rueda de negocios y feria binacional en Alto Paraná." },
  { id: "demo_event_feria_san_pedro", clientId: "demo_client_cocacola", name: "Feria Agropecuaria San Pedro", location: "Predio Prof. Dr. Arsenio Vasconsellos, Santa Rosa del Aguaray", month: 11, day: 11, days: 4, notes: "Tercera edición de la feria del norte: activación de marca, degustación y pantallas." },
  { id: "demo_event_agroshow", clientId: "demo_client_trebol", name: "Agroshow Copronar", location: "Naranjal, Alto Paraná", month: 11, day: 18, days: 3, startsHour: 8, notes: "26.ª edición del agroshow a campo abierto: stand institucional y degustación." },
  { id: "demo_event_ed_sheeran", clientId: "demo_client_ueno", name: "Ed Sheeran · Loop Tour", location: "Estadio ueno La Nueva Olla, Asunción", month: 11, day: 26, days: 1, startsHour: 19, notes: "Primer show del artista en Paraguay: pantallas de estadio, contenido vertical y activación." },
  { id: "demo_event_gorillaz", clientId: "demo_client_personal", name: "Gorillaz · The Mountain Tour", location: "Jockey Club Paraguayo, Asunción", month: 12, day: 1, days: 1, startsHour: 19, notes: "Show internacional: pantalla de escenario, streaming y activación de marca." },
  { id: "demo_event_agrodinamica", clientId: "demo_client_trebol", name: "Agrodinámica", location: "Campo Demostrativo Cooperativa Colonias Unidas, Hohenau", month: 12, day: 1, days: 5, notes: "30 años de la muestra de Itapúa: stand institucional, degustación y pantallas de sala." },
  { id: "demo_event_exposur_itapua", clientId: "demo_client_superseis", name: "Exposur Itapúa", location: "Centro Cívico Municipal, Encarnación", month: 1, day: 3, days: 9, startsHour: 17, notes: "Exposición del verano en Encarnación: pantalla de escenario, tótems y activación de marca." },
];

const REAL_EVENTS_COUNT = REAL_EVENTS.length;

/**
 * Eventos relativos a HOY: activaciones de marca (no tienen fecha publicada) y
 * el borrador. Garantizan que la demo siempre tenga algo en curso y algo
 * pendiente de confirmar, más allá de las fechas reales de las ferias. También
 * vive acá el evento cancelado (issue #24): un estado real que no se maquilla.
 */
type DemoRelativeEvent = {
  id: string;
  clientId: string;
  name: string;
  location: string;
  offsetDays: number;
  days: number;
  startsHour: number;
  draft?: boolean;
  cancelled?: boolean;
  notes: string;
};

const RELATIVE_EVENTS: readonly DemoRelativeEvent[] = [
  { id: "demo_event_activacion_mall", clientId: "demo_client_samsung", name: "Activación Samsung · Shopping del Sol", location: "Shopping del Sol, Asunción", offsetDays: -1, days: 3, startsHour: 10, notes: "Activación en el atrio: pantalla LED, tótems interactivos y demo de producto." },
  { id: "demo_event_activacion_tigo", clientId: "demo_client_tigo", name: "Activación Tigo · Paseo La Galería", location: "Paseo La Galería, Asunción", offsetDays: 4, days: 2, startsHour: 16, notes: "Lanzamiento de planes en el atrio central, con pantalla y sonido." },
  { id: "demo_event_showroom_nissei", clientId: "demo_client_nissei", name: "Cyberday · showroom Nissei", location: "Nissei · Shopping Mariscal, Asunción", offsetDays: 6, days: 2, startsHour: 11, notes: "Showroom de la campaña: pantalla de ofertas, tótems y transmisión en vivo." },
  { id: "demo_event_cancelado", clientId: "demo_client_shopping", name: "Pasarela Primavera · Shopping del Sol", location: "Atrio central, Shopping del Sol, Asunción", offsetDays: 14, days: 2, startsHour: 20, cancelled: true, notes: "Cancelado: la marca postergó la campaña para noviembre y el presupuesto quedó perdido." },
  { id: "demo_event_activacion_verano", clientId: "demo_client_cerveza", name: "Activación Cervecería Paraguaya · Costanera", location: "Costanera de Asunción", offsetDays: 45, days: 3, startsHour: 18, draft: true, notes: "Borrador: falta la habilitación municipal y cerrar la estructura del escenario." },
];

const RELATIVE_EVENTS_COUNT = RELATIVE_EVENTS.length;

// ── Inventario, promotoras y leads ──────────────────────────────────────────

const INVENTORY = [
  { id: "demo_inv_led_p3", name: "Pantalla LED P3.9 500x500", category: "Pantallas LED", sku: "LED-P3-500", kind: "REUSABLE", status: "RESERVED", quantity: 40, replacementCost: 1_850_000, dailyCost: 45_000, notes: "Gabinetes con fuente y cableado; se guardan en el depósito." },
  { id: "demo_inv_led_p5", name: "Pantalla LED P5 outdoor 960x960", category: "Pantallas LED", sku: "LED-P5-960", kind: "REUSABLE", status: "IN_USE", quantity: 24, replacementCost: 2_400_000, dailyCost: 60_000, notes: "Seis gabinetes afectados a la activación en curso." },
  { id: "demo_inv_totem", name: "Tótem LED 2x1 m", category: "Tótems", sku: "TOT-LED-2X1", kind: "REUSABLE", status: "MAINTENANCE", quantity: 6, replacementCost: 3_200_000, dailyCost: 90_000, notes: "Un tótem volvió con el marco doblado (ver devolución de la Expo)." },
  { id: "demo_inv_totem_touch", name: "Tótem Touch 43\"", category: "Tótems", sku: "TOT-TCH-43", kind: "REUSABLE", status: "AVAILABLE", quantity: 4, replacementCost: 4_100_000, dailyCost: 120_000, notes: "Con software de consulta y encuestas." },
  { id: "demo_inv_kiosko", name: "Kiosko Touch 32\"", category: "Kioskos", sku: "KIO-32", kind: "REUSABLE", status: "AVAILABLE", quantity: 3, replacementCost: 3_600_000, dailyCost: 110_000, notes: null },
  { id: "demo_inv_cilindro", name: "Cilindro LED 1.5 m", category: "Cilindros", sku: "CIL-15", kind: "REUSABLE", status: "AVAILABLE", quantity: 8, replacementCost: 2_200_000, dailyCost: 75_000, notes: null },
  { id: "demo_inv_dispenser", name: "Dispensador inteligente", category: "Activaciones", sku: "DISP-01", kind: "REUSABLE", status: "AVAILABLE", quantity: 2, replacementCost: 1_100_000, dailyCost: 35_000, notes: "Dispensa premios con conteo por evento." },
  { id: "demo_inv_cable", name: "Cable UTP Cat6 (rollo 100 m)", category: "Insumos", sku: "CBL-UTP6", kind: "CONSUMABLE", status: "AVAILABLE", quantity: 12, replacementCost: 180_000, dailyCost: 0, notes: null },
  { id: "demo_inv_truss", name: "Estructura de truss 2 m", category: "Estructuras", sku: "TRS-2M", kind: "REUSABLE", status: "RESERVED", quantity: 30, replacementCost: 450_000, dailyCost: 12_000, notes: null },
  { id: "demo_inv_panels", name: "Bastidor de piso para pantalla", category: "Estructuras", sku: "BAS-PISO", kind: "REUSABLE", status: "AVAILABLE", quantity: 18, replacementCost: 620_000, dailyCost: 18_000, notes: "Dos bastidores quedaron sin volver de la última feria (reclamo abierto)." },
] satisfies Array<{ id: string } & Omit<Prisma.InventoryItemUncheckedCreateInput, "id" | "organizationId">>;

/**
 * Promotoras del equipo de campo (issue #24): la disponibilidad es un estado
 * real, no un adorno. Dos de ellas no están disponibles o están a definir, y una
 * queda asignada a una tarea para que el panel muestre el aviso.
 */
type DemoPromoter = {
  id: string;
  name: string;
  phone: string;
  email: string;
  specialties: string;
  active: boolean;
  notes: string | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | "TO_DEFINE";
  availabilityNote: string | null;
  /** Días desde HOY del "hasta"; se re-ancla en cada provisión (`null` = sin fecha). */
  unavailableInDays: number | null;
  /** Iniciales y color de la foto generada de la demo (sin assets externos). */
  initials: string;
  accent: Rgba;
};

const PROMOTERS: readonly DemoPromoter[] = [
  { id: "demo_promoter_ana", name: "Ana Villalba", phone: "+595 981 445 210", email: "ana.villalba@ledbox.demo", specialties: "Activación de marca, degustación", active: true, notes: "Disponible los fines de semana.", availability: "AVAILABLE", availabilityNote: null, unavailableInDays: null, initials: "AV", accent: [0, 168, 186, 255] },
  { id: "demo_promoter_lorena", name: "Lorena Ríos", phone: "+595 983 220 118", email: "lorena.rios@ledbox.demo", specialties: "Registro de invitados, acreditaciones", active: true, notes: null, availability: "UNAVAILABLE", availabilityNote: "De viaje por trabajo; retoma a fin de mes.", unavailableInDays: 9, initials: "LR", accent: [122, 68, 220, 255] },
  { id: "demo_promoter_mabel", name: "Mabel Acosta", phone: "+595 971 909 330", email: "mabel.acosta@ledbox.demo", specialties: "Fotografía y redes sociales", active: true, notes: "Lleva cámara propia.", availability: "TO_DEFINE", availabilityNote: "Todavía no confirmó los fines de semana de octubre.", unavailableInDays: null, initials: "MA", accent: [214, 51, 132, 255] },
  { id: "demo_promoter_javier", name: "Javier Paredes", phone: "+595 985 771 042", email: "javier.paredes@ledbox.demo", specialties: "Montaje y soporte técnico", active: true, notes: null, availability: "AVAILABLE", availabilityNote: null, unavailableInDays: null, initials: "JP", accent: [22, 163, 108, 255] },
];

const PROMOTER_IDS = PROMOTERS.map((promoter) => promoter.id);

const SUPPLIERS = [
  { id: "demo_supplier_grafica", name: "Gráfica La Colmena", company: "Gráfica La Colmena S.A.", phone: "+595 21 445 900", email: "ventas@lacolmena.com.py", category: "GRAPHICS", paymentTerms: "50% de anticipo y saldo contra entrega", notes: "Banners, vinilos y cartelería. Entrega en 48 h." },
  { id: "demo_supplier_carpinteria", name: "Carpintería Benítez", company: "Benítez Muebles y Estructuras", phone: "+595 984 220 118", email: "taller@carpinteriabenitez.com.py", category: "CARPENTRY", paymentTerms: "Anticipo 40%, saldo a 15 días", notes: "Escenarios, stands y mobiliario a medida." },
  { id: "demo_supplier_transporte", name: "Transportes Ríos", company: "Ríos Logística", phone: "+595 971 808 260", email: "operaciones@transportesrios.com.py", category: "TRANSPORT", paymentTerms: "Contado contra entrega", notes: "Fletes con hidrogrúa para pantallas y truss." },
  { id: "demo_supplier_audio", name: "Audio Sur", company: "Audio Sur Producciones", phone: "+595 982 664 901", email: "produccion@audiosur.com.py", category: "AUDIOVISUAL", paymentTerms: "Anticipo 30%, saldo al desmontaje", notes: "Sonido, iluminación y monitoreo." },
  { id: "demo_supplier_electricidad", name: "Electricidad Meza", company: "Meza Servicios Eléctricos", phone: "+595 985 330 774", email: "contacto@electricidadmeza.com.py", category: "ELECTRICITY", paymentTerms: "Contado", notes: "Tableros, generadores y puesta a tierra." },
] satisfies Array<{ id: string } & Omit<Prisma.SupplierUncheckedCreateInput, "id" | "organizationId">>;

type DemoLead = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  reason: string;
  message: string;
  status: "NEW" | "CONTACTED" | "WON" | "LOST";
  createdDaysAgo: number;
  eventDateDays: number;
  location: string;
  internalNotes: string | null;
};

const LEADS: readonly DemoLead[] = [
  { id: "demo_lead_cerveza", name: "Patricia Giménez", company: "Cervecería Paraguaya", phone: "+595 981 300 700", email: "pgimenez@cervezaparaguaya.demo", reason: "Evento de fin de año", message: "Necesitamos pantallas para el evento de fin de año y una pantalla de bienvenida.", status: "NEW", createdDaysAgo: 1, eventDateDays: 40, location: "Asunción", internalNotes: null },
  { id: "demo_lead_constructora", name: "Roberto Ayala", company: "Constructora Ayala", phone: "+595 984 112 233", email: "rayala@constructoraayala.demo", reason: "Lanzamiento de proyecto", message: "Lanzamos un barrio nuevo; queremos pantalla exterior y sonido.", status: "NEW", createdDaysAgo: 2, eventDateDays: 25, location: "Luque", internalNotes: null },
  { id: "demo_lead_vision", name: "Carla Núñez", company: "Visión Banco", phone: "+595 972 664 812", email: "carla.nunez@visionbanco.demo", reason: "Jornada de sucursales", message: "Jornada regional de sucursales con pantalla principal y acreditación.", status: "CONTACTED", createdDaysAgo: 6, eventDateDays: 33, location: "Encarnación", internalNotes: "Pidió cotización para dos fechas; llamar el lunes." },
  { id: "demo_lead_superseis", name: "Diego Ocampos", company: "Superseis", phone: "+595 991 204 118", email: "diego.ocampos@superseis.demo", reason: "Aniversario de tienda", message: "Aniversario de la sucursal con activación de fin de semana.", status: "WON", createdDaysAgo: 20, eventDateDays: -4, location: "Asunción", internalNotes: "Cerró la activación; facturar a 30 días." },
  { id: "demo_lead_pixel", name: "Sandra Meza", company: "Agencia Punto Creativo", phone: "+595 983 991 004", email: "sandra.meza@punktocreativo.demo", reason: "Congreso interno", message: "Congreso de vendedores con pantalla principal y traducción.", status: "LOST", createdDaysAgo: 16, eventDateDays: 12, location: "San Bernardino", internalNotes: "Eligió otro proveedor por presupuesto." },
  // Sin respuesta hace semanas (issue #24): un lead que nunca se contactó.
  { id: "demo_lead_sin_respuesta", name: "Marcelo Aquino", company: "Frigorífico Concepción", phone: "+595 983 664 220", email: "maquino@frigorifico.concepcion.demo", reason: "Feria regional", message: "Necesitamos pantallas para una feria regional en Concepción; ¿tienen disponibilidad en octubre?", status: "NEW", createdDaysAgo: 24, eventDateDays: 32, location: "Concepción", internalNotes: "Entró por el sitio hace semanas y nadie lo contactó todavía." },
];

// ── Tesorería, gastos, correos e invitaciones (issues #27, #28, #30 y #31) ───
//
// La demo muestra el circuito completo del dinero: las cuentas con su saldo
// **derivado** de movimientos reales, los gastos con su egreso (dos «A definir»,
// sin proyecto, para que se vea la asignación desde la fila), los pagos
// esperados del plan (comprobante en revisión, vencido sin comprobante y
// confirmado con su cobro y movimiento), el historial de correos del proveedor y
// las invitaciones al equipo. Todo se re-ancla a HOY en cada provisión.

const DEMO_USER_AVATAR_INITIALS = "VD";

/**
 * Cuentas de tesorería (issue #27): el saldo no se guarda, sale del saldo
 * inicial declarado más los movimientos. Los ids son los que usan los cobros,
 * los gastos y los pagos esperados del dataset.
 */
const TREASURY_ACCOUNTS = [
  { id: "demo_treasury_cash", name: "Efectivo", type: "CASH", bank: null, openingBalance: 1_500_000, sortOrder: 0 },
  { id: "demo_treasury_ueno", name: "Ueno Bank", type: "BANK", bank: "Ueno Bank", openingBalance: 5_000_000, sortOrder: 1 },
  { id: "demo_treasury_cheques", name: "Cheques a cobrar", type: "CHEQUE", bank: null, openingBalance: 0, sortOrder: 2 },
] satisfies Array<{ id: string } & Omit<Prisma.TreasuryAccountUncheckedCreateInput, "id" | "organizationId" | "createdAt" | "updatedAt">>;

/** Transferencia ya hecha: el cheque de la seña se cobró y la plata pasó a caja. */
const DEMO_CHEQUE_TRANSFER_AMOUNT = 2_000_000;

type DemoExpense = {
  id: string;
  accountId: string;
  /** Evento asociado por rol; `null` = «A definir» (sin proyecto). */
  eventRole: "next" | "second" | "inProgress" | "recentPast" | "longestPast" | null;
  supplierId: string | null;
  daysAgo: number;
  hour: number;
  amount: number;
  category: "TRANSPORT" | "FUEL" | "FOOD" | "MATERIALS" | "RENT" | "SERVICES" | "SALARIES" | "TOOLS" | "OTHER";
  description: string;
  method: string | null;
  receipt: string | null;
  notes: string | null;
};

/**
 * Gastos (issue #27): cada uno con su categoría, su cuenta y su egreso. Los dos
 * sin `eventRole` quedan **«A definir»** a propósito, para que la demo muestre la
 * asignación del proyecto desde la fila.
 */
const EXPENSES: readonly DemoExpense[] = [
  { id: "demo_expense_generador", accountId: "demo_treasury_ueno", eventRole: "inProgress", supplierId: "demo_supplier_electricidad", daysAgo: 2, hour: 9, amount: 1_500_000, category: "RENT", description: "Alquiler de generador para el montaje", method: "Transferencia", receipt: "REC-9104", notes: "Cubre los días de montaje y desmontaje." },
  { id: "demo_expense_jornales", accountId: "demo_treasury_ueno", eventRole: "inProgress", supplierId: null, daysAgo: 1, hour: 18, amount: 1_800_000, category: "SALARIES", description: "Jornales del equipo de montaje", method: "Transferencia", receipt: null, notes: null },
  { id: "demo_expense_combustible", accountId: "demo_treasury_cash", eventRole: "next", supplierId: "demo_supplier_transporte", daysAgo: 3, hour: 8, amount: 850_000, category: "FUEL", description: "Combustible y peajes del traslado", method: "Efectivo", receipt: "REC-9099", notes: null },
  { id: "demo_expense_viaticos", accountId: "demo_treasury_cash", eventRole: "recentPast", supplierId: null, daysAgo: 9, hour: 13, amount: 320_000, category: "FOOD", description: "Viáticos del equipo en el predio", method: "Efectivo", receipt: null, notes: null },
  { id: "demo_expense_materiales", accountId: "demo_treasury_ueno", eventRole: "longestPast", supplierId: "demo_supplier_grafica", daysAgo: 12, hour: 10, amount: 1_240_000, category: "MATERIALS", description: "Vinilos y cartelería del pabellón", method: "Transferencia", receipt: "REC-9081", notes: "El remanente se usó en la activación siguiente." },
  { id: "demo_expense_streaming", accountId: "demo_treasury_ueno", eventRole: "second", supplierId: "demo_supplier_audio", daysAgo: 5, hour: 11, amount: 600_000, category: "SERVICES", description: "Internet dedicado y streaming del evento", method: "Transferencia", receipt: null, notes: null },
  // «A definir»: sin proyecto todavía (se asigna desde la fila en el panel).
  { id: "demo_expense_herramientas", accountId: "demo_treasury_cash", eventRole: null, supplierId: null, daysAgo: 4, hour: 16, amount: 450_000, category: "TOOLS", description: "Herramientas de taller (llaves y prensas)", method: "Efectivo", receipt: "REC-9092", notes: "Compra de reposición; falta asignarla a un evento." },
  { id: "demo_expense_cables", accountId: "demo_treasury_cash", eventRole: null, supplierId: null, daysAgo: 2, hour: 17, amount: 780_000, category: "MATERIALS", description: "Cables, fichas y conectores", method: "Efectivo", receipt: null, notes: "Sin proyecto todavía: se define al cerrar el mes." },
];

/**
 * Correos del historial (`MailLog`, issue #30): el presupuesto enviado al
 * cliente, un recordatorio de cobro, el correo de prueba y un fallo con su
 * motivo, más la invitación al equipo. El asunto y el destinatario se construyen
 * en la provisión, con los mismos formatos que los correos reales.
 */
type DemoMailLog = {
  id: string;
  category: "budget" | "reminder" | "test" | "invitation";
  status: "sent" | "failed";
  /** Correo del destinatario; se resuelve por rol del dataset. */
  to: "pendingBudgetClient" | "moraClient" | "valeria" | "invited" | "demoUser";
  subject: string;
  error: string | null;
  entity: string | null;
  entityId: string | null;
  actor: "sales" | "system";
  daysAgo: number;
  hour: number;
  minute: number;
};

const MAIL_LOGS: readonly DemoMailLog[] = [
  { id: "demo_mail_budget", category: "budget", status: "sent", to: "pendingBudgetClient", subject: "Presupuesto · LedBox Demo", error: null, entity: "Budget", entityId: "demo_budget_pendiente", actor: "sales", daysAgo: 6, hour: 9, minute: 22 },
  { id: "demo_mail_reminder_mora_1", category: "reminder", status: "sent", to: "moraClient", subject: "Recordatorio de pago · Cuota 1 · LedBox Demo", error: null, entity: "ClientPayment", entityId: "demo_pay_mora_cuota_1", actor: "system", daysAgo: 2, hour: 8, minute: 5 },
  { id: "demo_mail_test", category: "test", status: "sent", to: "valeria", subject: "Correo de prueba · LedBox Demo", error: null, entity: "Organization", entityId: DEMO_ORGANIZATION_ID, actor: "sales", daysAgo: 14, hour: 10, minute: 40 },
  // Falló de verdad: sin dominio verificado el proveedor rechaza el envío.
  { id: "demo_mail_reminder_mora_2", category: "reminder", status: "failed", to: "moraClient", subject: "Recordatorio de pago · Cuota 2 · LedBox Demo", error: "El dominio del remitente no está verificado en Resend (403): el recordatorio no salió.", entity: "ClientPayment", entityId: "demo_pay_mora_cuota_2", actor: "system", daysAgo: 1, hour: 8, minute: 5 },
  { id: "demo_mail_invitation", category: "invitation", status: "sent", to: "invited", subject: "Invitación al equipo de LedBox Demo · LedBox", error: null, entity: "TeamInvitation", entityId: "demo_invitation_pending", actor: "sales", daysAgo: 1, hour: 11, minute: 15 },
];

/**
 * Invitaciones al equipo (issue #31): una pendiente (con su correo simulado) y
 * una aceptada que ya es miembro. El token solo se guarda hasheado, igual que en
 * el flujo real.
 */
type DemoInvitation = {
  id: string;
  email: string;
  role: "ADMIN" | "OPERATIONS" | "FINANCE" | "VIEWER";
  status: "pending" | "accepted";
  /** Token del link (solo vive acá para derivar su hash; nunca se guarda plano). */
  token: string;
  createdDaysAgo: number;
  expiresInDays: number;
  sentDaysAgo: number;
  sentCount: number;
  acceptedDaysAgo?: number;
  acceptedBy?: { id: string; name: string };
};

const INVITATIONS: readonly DemoInvitation[] = [
  {
    id: "demo_invitation_pending",
    email: "rocio.benitez@ledbox.demo",
    role: "FINANCE",
    status: "pending",
    token: "D3M0-ROC1-9F7K-2QW4",
    createdDaysAgo: 1,
    expiresInDays: 12,
    sentDaysAgo: 1,
    sentCount: 1,
  },
  {
    id: "demo_invitation_accepted",
    email: "marco.ferreira@ledbox.demo",
    role: "OPERATIONS",
    status: "accepted",
    token: "D3M0-MAR2-4X2B-8LQ6",
    createdDaysAgo: 27,
    expiresInDays: -20,
    sentDaysAgo: 27,
    sentCount: 2,
    acceptedDaysAgo: 21,
    acceptedBy: { id: "demo_user_marco", name: "Marco Ferreira" },
  },
];

/** Quién invita en la demo: Valeria es ADMIN de la empresa (rol users.manage). */
const DEMO_INVITER = { id: "demo_user_valeria", name: "Valeria Ortiz", email: "valeria.ortiz@ledbox.demo" };

/**
 * Equipo simulado de la empresa demo: dos colaboradores reales del dataset (los
 * mismos actores de la auditoría) para que Usuarios, las invitaciones y los
 * avatares tengan a quién apuntar. Son miembros solo de la empresa demo.
 */
const COLLABORATORS = [
  { id: ACTORS.sales.id, name: ACTORS.sales.name, email: ACTORS.sales.email, role: "ADMIN", initials: "VO", accent: [0, 176, 186, 255] as Rgba },
  { id: ACTORS.ops.id, name: ACTORS.ops.name, email: ACTORS.ops.email, role: "OPERATIONS", initials: "MF", accent: [122, 68, 220, 255] as Rgba },
] satisfies Array<{ id: string; name: string; email: string; role: "ADMIN" | "OPERATIONS"; initials: string; accent: Rgba }>;

// ── Plantillas de mensajes de WhatsApp (issue #35) ──────────────────────────
//
// La demo entra a `/plantillas` con contenido real: plantillas de LedBox
// repartidas por las cuatro categorías de envío, cada una con las variables de
// su catálogo (una variable fuera de categoría es un error de guardado). Las
// creó Valeria, la ADMIN de la empresa demo; como la demo es de solo lectura,
// se listan y se previsualizan, pero no se editan ni se borran.

type DemoMessageTemplate = {
  id: string;
  category: MessageTemplateCategoryValue;
  title: string;
  body: string;
  sortOrder: number;
};

const DEMO_MESSAGE_TEMPLATES: readonly DemoMessageTemplate[] = [
  {
    id: "demo_tpl_cotizacion_enviada",
    category: "budget",
    title: "Cotización enviada",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: te compartimos la cotización «{{presupuesto}}» de {{empresa}}.",
      "",
      "• Total: {{monto}}",
      "• Validez: hasta el {{vencimiento}}",
      "• Detalle y aprobación en el portal: {{link_portal}}",
      "",
      "Si querés ajustar ítems, equipos o días de alquiler, avisanos.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    id: "demo_tpl_seguimiento_cotizacion",
    category: "budget",
    title: "Seguimiento de cotización",
    sortOrder: 20,
    body: [
      "Hola {{cliente}}: ¿cómo estás? Soy {{vendedor}}, de {{empresa}}.",
      "",
      "Te escribo para saber si pudiste revisar la cotización «{{presupuesto}}» por {{monto}}. Si querés, vemos los equipos, los días de alquiler o la forma de pago.",
      "",
      "La cotización sigue vigente hasta el {{vencimiento}}.",
    ].join("\n"),
  },
  {
    id: "demo_tpl_recordatorio_saldo",
    category: "collection",
    title: "Recordatorio de saldo",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: te escribimos de {{empresa}} por el saldo pendiente de «{{presupuesto}}».",
      "",
      "• Saldo: {{saldo}}",
      "• Vencimiento: {{vencimiento}}",
      "• Detalle y datos de pago en el portal: {{link_portal}}",
      "",
      "Si ya abonaste, ignorá este mensaje.",
      "{{vendedor}}",
    ].join("\n"),
  },
  {
    id: "demo_tpl_pago_acreditado",
    category: "collection",
    title: "Pago acreditado",
    sortOrder: 20,
    body: [
      "Hola {{cliente}}: ¡gracias! Acreditamos el pago de {{monto}} de «{{presupuesto}}».",
      "",
      "Te enviamos el comprobante en cuanto esté emitido. Cualquier duda quedo a disposición.",
      "{{vendedor}} · {{empresa}}",
    ].join("\n"),
  },
  {
    id: "demo_tpl_montaje_evento",
    category: "event",
    title: "Coordinación de montaje",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: coordinamos la llegada de nuestro equipo para «{{evento}}».",
      "",
      "• Fecha: {{fecha}}",
      "• Lugar: {{lugar}}",
      "",
      "Necesitamos el acceso al predio unas horas antes para el montaje y la prueba de las pantallas. Si cambia el horario, avisanos por acá.",
      "",
      "{{vendedor}} · {{empresa}}",
    ].join("\n"),
  },
  {
    id: "demo_tpl_bienvenida_cliente",
    category: "client",
    title: "Bienvenida y coordinación",
    sortOrder: 10,
    body: [
      "Hola {{cliente}}: ¡gracias por elegir a {{empresa}}! Soy {{vendedor}} y te acompaño en la coordinación de tus eventos.",
      "",
      "Cuando quieras sumar equipos, fechas o una activación nueva, escribime por acá.",
    ].join("\n"),
  },
];

// ── Identidad: logos y avatares de la demo (PNG generados, sin dependencias) ──

type Rgba = readonly [number, number, number, number];

/** Imagen binaria lista para Prisma (`Bytes`), con su tipo real. */
type DemoImage = { mime: string; size: number; width: number; height: number; data: Uint8Array<ArrayBuffer> };

type PixelCanvas = { width: number; height: number; pixels: Uint8Array };

const IDENTITY_ACCENT: Rgba = [0, 214, 214, 255];
const IDENTITY_INK: Rgba = [10, 14, 18, 255];
const IDENTITY_LIGHT: Rgba = [235, 247, 249, 255];
const IDENTITY_PAPER: Rgba = [248, 250, 252, 255];
const IDENTITY_GREY: Rgba = [186, 196, 204, 255];
const IDENTITY_OK: Rgba = [22, 163, 108, 255];

/** Glifos 5×7 de las letras que usan el logo, los avatares y los monogramas. */
const GLYPHS: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
};

function newCanvas(width: number, height: number, fill: Rgba): PixelCanvas {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = fill[0];
    pixels[index * 4 + 1] = fill[1];
    pixels[index * 4 + 2] = fill[2];
    pixels[index * 4 + 3] = fill[3];
  }
  return { width, height, pixels };
}

function setPixel(canvas: PixelCanvas, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const offset = (y * canvas.width + x) * 4;
  canvas.pixels[offset] = color[0];
  canvas.pixels[offset + 1] = color[1];
  canvas.pixels[offset + 2] = color[2];
  canvas.pixels[offset + 3] = color[3];
}

function fillRect(canvas: PixelCanvas, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) setPixel(canvas, x + column, y + row, color);
  }
}

/** Diagonal de dos colores (fondo de los avatares). */
function paintGradient(canvas: PixelCanvas, from: Rgba, to: Rgba): void {
  const span = canvas.width + canvas.height;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const ratio = (x + y) / span;
      setPixel(canvas, x, y, [
        Math.round(from[0] + (to[0] - from[0]) * ratio),
        Math.round(from[1] + (to[1] - from[1]) * ratio),
        Math.round(from[2] + (to[2] - from[2]) * ratio),
        Math.round(from[3] + (to[3] - from[3]) * ratio),
      ]);
    }
  }
}

/** Dibuja texto en mayúsculas con los glifos 5×7; devuelve el ancho usado. */
function paintLetters(canvas: PixelCanvas, text: string, x: number, y: number, scale: number, tracking: number, color: Rgba): number {
  let cursor = x;
  for (const character of text) {
    const glyph = GLYPHS[character];
    if (!glyph) {
      cursor += 5 * scale + tracking;
      continue;
    }
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((bit, columnIndex) => {
        if (bit === "1") fillRect(canvas, cursor + columnIndex * scale, y + rowIndex * scale, scale, scale, color);
      });
    });
    cursor += 5 * scale + tracking;
  }
  return cursor - tracking - x;
}

function lettersWidth(text: string, scale: number, tracking: number): number {
  return text.length * 5 * scale + (text.length - 1) * tracking;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG RGBA (color type 6) sin filtros: deflate + CRC32, con `node:zlib`. */
function encodePng(canvas: PixelCanvas): DemoImage {
  const stride = canvas.width * 4;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(canvas.pixels.buffer, canvas.pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array()),
  ]);
  const data = new Uint8Array(png.byteLength);
  data.set(png);
  return { mime: "image/png", size: data.byteLength, width: canvas.width, height: canvas.height, data };
}

/** Logo de la empresa: «LED» en cyan y «BOX» en el color del tema, sobre transparente. */
function buildLogoImage(variant: "light" | "dark"): DemoImage {
  const canvas = newCanvas(480, 120, [0, 0, 0, 0]);
  const scale = 12;
  const tracking = 12;
  const gap = 24;
  const accent = variant === "light" ? IDENTITY_ACCENT : [0, 168, 178, 255] as Rgba;
  const ink = variant === "light" ? IDENTITY_LIGHT : IDENTITY_INK;
  const width = lettersWidth("LED", scale, tracking) + gap + lettersWidth("BOX", scale, tracking);
  const x = Math.round((canvas.width - width) / 2);
  const y = 14;
  const afterLed = paintLetters(canvas, "LED", x, y, scale, tracking, accent) + x + gap;
  paintLetters(canvas, "BOX", afterLed, y, scale, tracking, ink);
  fillRect(canvas, x, y + 7 * scale + 8, width, 5, accent);
  return encodePng(canvas);
}

/** Avatar del equipo: gradiente + iniciales en blanco. */
function buildAvatarImage(initials: string, from: Rgba, to: Rgba): DemoImage {
  const canvas = newCanvas(256, 256, IDENTITY_INK);
  paintGradient(canvas, from, to);
  const scale = 20;
  const tracking = 20;
  const width = lettersWidth(initials, scale, tracking);
  const x = Math.round((canvas.width - width) / 2);
  const y = Math.round((canvas.height - 7 * scale) / 2) + 6;
  paintLetters(canvas, initials, x, y, scale, tracking, [255, 255, 255, 255]);
  return encodePng(canvas);
}

/** Comprobante simulado del cliente: una página con encabezado y renglones. */
function buildProofImage(): DemoImage {
  const canvas = newCanvas(420, 560, IDENTITY_PAPER);
  fillRect(canvas, 0, 0, canvas.width, 64, [0, 168, 178, 255]);
  fillRect(canvas, 24, 18, 132, 12, [255, 255, 255, 235]);
  fillRect(canvas, 24, 38, 84, 8, [255, 255, 255, 190]);
  const rows = [120, 160, 200, 240, 296, 336, 376];
  const widths = [300, 220, 340, 260, 180, 320, 240];
  rows.forEach((row, index) => fillRect(canvas, 32, row, widths[index], 10, IDENTITY_GREY));
  fillRect(canvas, 32, 200, 120, 10, IDENTITY_INK);
  fillRect(canvas, 32, 296, 200, 14, IDENTITY_INK);
  // Check verde: el importe y la acreditación.
  fillRect(canvas, 300, 430, 24, 12, IDENTITY_OK);
  fillRect(canvas, 324, 418, 24, 24, IDENTITY_OK);
  fillRect(canvas, 348, 406, 36, 36, IDENTITY_OK);
  fillRect(canvas, 32, 500, 356, 8, IDENTITY_GREY);
  return encodePng(canvas);
}

type DemoIdentityImages = {
  logoLight: DemoImage;
  logoDark: DemoImage;
  demoAvatar: DemoImage;
  collaborators: Map<string, DemoImage>;
  proof: DemoImage;
  /** Logo de cada cliente demo (issue #36): monograma de iniciales y color de marca. */
  clientLogos: Map<string, DemoImage>;
  /** Foto de cada promotora demo (issue #36): mismo monograma generado. */
  promoterPhotos: Map<string, DemoImage>;
};

let identityImages: DemoIdentityImages | null = null;

/** Imágenes de identidad de la demo (se generan una vez por proceso). */
function demoIdentityImages(): DemoIdentityImages {
  if (!identityImages) {
    const collaborators = new Map<string, DemoImage>();
    for (const collaborator of COLLABORATORS) {
      collaborators.set(collaborator.id, buildAvatarImage(collaborator.initials, IDENTITY_INK, collaborator.accent));
    }
    const clientLogos = new Map<string, DemoImage>();
    for (const client of CLIENTS) {
      const profile = CLIENT_PROFILES[client.id];
      if (profile) clientLogos.set(client.id, buildAvatarImage(profile.initials, IDENTITY_INK, profile.accent));
    }
    const promoterPhotos = new Map<string, DemoImage>();
    for (const promoter of PROMOTERS) {
      promoterPhotos.set(promoter.id, buildAvatarImage(promoter.initials, IDENTITY_INK, promoter.accent));
    }
    identityImages = {
      logoLight: buildLogoImage("light"),
      logoDark: buildLogoImage("dark"),
      demoAvatar: buildAvatarImage(DEMO_USER_AVATAR_INITIALS, IDENTITY_INK, IDENTITY_ACCENT),
      collaborators,
      proof: buildProofImage(),
      clientLogos,
      promoterPhotos,
    };
  }
  return identityImages;
}

// ── Mínimos del dataset ─────────────────────────────────────────────────────

/**
 * Mínimos del dataset simulado. El ancla del día se valida contra estos conteos
 * (y contra la agenda futura) para que una provisión interrumpida, un borrado o
 * una demo que se quedó sin eventos próximos se vuelva a completar sola. Si se
 * agregan filas al dataset, se suben estos números.
 */
const DATASET_MINS = {
  clients: CLIENTS.length,
  clientLogos: CLIENTS.length,
  promoterPhotos: PROMOTERS.length,
  events: REAL_EVENTS_COUNT + RELATIVE_EVENTS_COUNT,
  tasks: (REAL_EVENTS_COUNT + RELATIVE_EVENTS_COUNT) * 4,
  budgets: 7,
  audits: 32,
  treasuryAccounts: TREASURY_ACCOUNTS.length,
  treasuryMovements: 16,
  expenses: EXPENSES.length,
  expectedPayments: 8,
  invitations: INVITATIONS.length,
  mailLogs: MAIL_LOGS.length,
  messageTemplates: DEMO_MESSAGE_TEMPLATES.length,
  logos: 2,
} as const;

// ── Alta idempotente ────────────────────────────────────────────────────────

/**
 * Asegura la organización demo, el usuario demo y los datos simulados, y
 * devuelve el destino de la sesión demo. Es idempotente y re-ancla el dataset a
 * hoy (una vez por día o cuando la agenda quedó sin eventos futuros).
 *
 * Con `reset` se re-siembra aunque el dataset esté fresco: lo usa la entrada al
 * presupuesto de ejemplo (issue #29) cuando una visita anterior lo aprobó y la
 * demo se quedó sin el caso de autogestión.
 */
export async function ensureDemoData(options?: { reset?: boolean }): Promise<DemoSessionTarget> {
  const base = todayBase();

  // El ancla del dataset es el `updatedAt` de la organización demo. Se lee ANTES
  // de tocar la organización para que una provisión a medias no se marque como
  // completa.
  let organization = await db.organization.findUnique({ where: { slug: DEMO_ORGANIZATION_SLUG } });
  const fresh = organization && !options?.reset ? await demoDataIsFresh(organization) : false;
  if (!organization) {
    organization = await db.organization.create({ data: DEMO_ORGANIZATION });
  } else if (organization.name !== DEMO_ORGANIZATION_NAME || !organization.active) {
    organization = await db.organization.update({
      where: { id: organization.id },
      data: { name: DEMO_ORGANIZATION_NAME, active: true },
    });
  }
  // Los datos de pago se completan si faltan; si la empresa ya los tiene (los
  // administra OWNER/ADMIN en el panel), no se pisan.
  if (!hasPaymentDetails(organization.paymentDetails)) {
    organization = await db.organization.update({
      where: { id: organization.id },
      data: { paymentDetails: DEMO_PAYMENT_DETAILS },
    });
  }

  // Plan de la demo (issue #42): Pro, con el inicio en el alta de la empresa. La
  // demo es de solo lectura: el plan se ve (consumo y comparación), no se cambia.
  const demoPlan = await db.plan.findUnique({ where: { code: DEMO_PLAN_CODE }, select: { id: true } });
  if (demoPlan && organization.planId !== demoPlan.id) {
    organization = await db.organization.update({
      where: { id: organization.id },
      data: { planId: demoPlan.id, planStartedAt: organization.planStartedAt ?? organization.createdAt },
    });
  }

  // El usuario demo nunca inicia sesión con contraseña: la clave es aleatoria y
  // el único camino es `GET/POST /api/demo/session`. Su rol global es VIEWER.
  // Tampoco tiene PIN ni auto-bloqueo (issue #32): la demo no se bloquea sola.
  const user = await db.adminUser.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: {
      id: DEMO_USER_ID,
      name: DEMO_USER_NAME,
      email: DEMO_USER_EMAIL,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      role: "VIEWER",
      active: true,
      pinHash: null,
      pinUpdatedAt: null,
      autoLockEnabled: false,
    },
    update: {
      name: DEMO_USER_NAME,
      role: "VIEWER",
      active: true,
      pinHash: null,
      pinUpdatedAt: null,
      autoLockEnabled: false,
    },
  });

  await db.adminMembership.upsert({
    where: { adminUserId_organizationId: { adminUserId: user.id, organizationId: organization.id } },
    create: {
      id: DEMO_MEMBERSHIP_ID,
      adminUserId: user.id,
      organizationId: organization.id,
      role: "VIEWER",
      active: true,
    },
    update: { role: "VIEWER", active: true },
  });

  // Limpieza: las sesiones demo vencidas o revocadas no se acumulan.
  await db.adminSession.deleteMany({
    where: {
      userId: user.id,
      OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
    },
  });

  if (!fresh) {
    await seedDemoData(organization.id, base);
    // Ancla del día: mientras `updatedAt` sea de hoy, no se vuelve a escribir.
    await db.organization.update({
      where: { id: organization.id },
      data: { name: DEMO_ORGANIZATION_NAME, paymentDetails: DEMO_PAYMENT_DETAILS },
    });
  }

  return {
    organizationId: organization.id,
    user: { id: user.id, name: user.name, email: user.email, role: "VIEWER" },
  };
}

/**
 * El dataset está completo y anclado a hoy. Además de los conteos mínimos se
 * exige **agenda futura**: si la demo se quedó sin eventos próximos (pasaron
 * los días), el próximo ingreso corre las fechas hacia adelante y re-deriva los
 * estados.
 */
async function demoDataIsFresh(organization: { id: string; updatedAt: Date }): Promise<boolean> {
  const now = new Date();
  const [clients, clientLogos, promoterPhotos, events, tasks, budgets, audits, upcoming, treasuryAccounts, treasuryMovements, expenses, expectedPayments, invitations, mailLogs, messageTemplates, logos, avatars] = await Promise.all([
    db.client.count({ where: { organizationId: organization.id } }),
    db.clientLogo.count({ where: { client: { organizationId: organization.id } } }),
    db.promoter.count({ where: { organizationId: organization.id, photoUrl: { not: null } } }),
    db.event.count({ where: { organizationId: organization.id } }),
    db.eventTask.count({ where: { event: { organizationId: organization.id } } }),
    db.budget.count({ where: { organizationId: organization.id } }),
    db.auditLog.count({ where: { organizationId: organization.id } }),
    db.event.count({
      where: {
        organizationId: organization.id,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }],
      },
    }),
    db.treasuryAccount.count({ where: { organizationId: organization.id } }),
    db.treasuryMovement.count({ where: { organizationId: organization.id } }),
    db.expense.count({ where: { organizationId: organization.id } }),
    db.expectedPayment.count({ where: { organizationId: organization.id } }),
    db.teamInvitation.count({ where: { organizationId: organization.id } }),
    db.mailLog.count({ where: { organizationId: organization.id } }),
    db.messageTemplate.count({ where: { organizationId: organization.id } }),
    db.organizationLogo.count({ where: { organizationId: organization.id } }),
    db.adminUserAvatar.count({ where: { userId: { in: [DEMO_USER_ID, ...COLLABORATORS.map((collaborator) => collaborator.id)] } } }),
  ]);
  const complete =
    clients >= DATASET_MINS.clients &&
    clientLogos >= DATASET_MINS.clientLogos &&
    promoterPhotos >= DATASET_MINS.promoterPhotos &&
    events >= DATASET_MINS.events &&
    tasks >= DATASET_MINS.tasks &&
    budgets >= DATASET_MINS.budgets &&
    audits >= DATASET_MINS.audits &&
    treasuryAccounts >= DATASET_MINS.treasuryAccounts &&
    treasuryMovements >= DATASET_MINS.treasuryMovements &&
    expenses >= DATASET_MINS.expenses &&
    expectedPayments >= DATASET_MINS.expectedPayments &&
    invitations >= DATASET_MINS.invitations &&
    mailLogs >= DATASET_MINS.mailLogs &&
    messageTemplates >= DATASET_MINS.messageTemplates &&
    logos >= DATASET_MINS.logos &&
    avatars >= COLLABORATORS.length + 1 &&
    upcoming >= 3;
  if (!complete) return false;
  return dayKeyOf(organization.updatedAt) === dayKeyOf(new Date());
}

// ── Presupuesto de ejemplo del portal (issue #29) ───────────────────────────

/**
 * Presupuesto de la demo que abre la portada del portal: el de autogestión
 * (link público activo, `SENT`, sin aprobar), para poder ajustar ítems, pedir
 * rebaja y enviar propuesta. El id es el que siembra el dataset de acá abajo.
 */
export const DEMO_PORTAL_BUDGET_ID = "demo_budget_pendiente";

/**
 * Devuelve el presupuesto de ejemplo solo si sigue abierto para la autogestión
 * (sin aprobar y en un estado en juego, el mismo criterio que usa la demo del
 * panel); si no, `null` para que la entrada al ejemplo re-siembre el dataset.
 */
export async function loadDemoPortalBudget(
  organizationId: string,
): Promise<{ id: string; title: string; publicToken: string | null } | null> {
  return db.budget.findFirst({
    where: {
      id: DEMO_PORTAL_BUDGET_ID,
      organizationId,
      publicToken: { not: null },
      approvedAt: null,
      status: { in: ["SENT", "NEGOTIATING"] },
    },
    select: { id: true, title: true, publicToken: true },
  });
}

// ── Dataset ─────────────────────────────────────────────────────────────────

type BuiltEvent = {
  id: string;
  clientId: string;
  name: string;
  location: string;
  notes: string;
  setupAt: Date;
  startsAt: Date;
  endsAt: Date;
  strikeAt: Date;
  status: DemoEventStatus;
  durationDays: number;
  /** El cobro quedó pendiente (derivado: los finalizados más recientes). */
  openBalance: boolean;
};

type EventSeed = {
  id: string;
  clientId: string;
  name: string;
  location: string;
  notes: string;
  days: number;
  startsHour: number;
  draft?: boolean;
  cancelled?: boolean;
};

function finalizeEvent(seed: EventSeed, startsAt: Date, now: Date): BuiltEvent {
  const setupAt = atDay(startsAt, -1, 8, 0);
  const endHour = seed.startsHour >= 18 ? 23 : 21;
  const endsAt = atDay(startsAt, seed.days - 1, endHour, 0);
  const strikeAt = atDay(startsAt, seed.days, 9, 0);
  return {
    id: seed.id,
    clientId: seed.clientId,
    name: seed.name,
    location: seed.location,
    notes: seed.notes,
    setupAt,
    startsAt,
    endsAt,
    strikeAt,
    status: eventStatusFrom(startsAt, endsAt, now, seed.draft, seed.cancelled),
    durationDays: seed.days,
    openBalance: false,
  };
}

/** Eventos con el año proyectado a la ventana móvil ±6 meses. */
function buildEvents(base: Date, now: Date): BuiltEvent[] {
  const real = REAL_EVENTS.map((seed) =>
    finalizeEvent(
      { ...seed, startsHour: seed.startsHour ?? 14 },
      nearestOccurrence(seed.month, seed.day, seed.startsHour ?? 14, now),
      now,
    ),
  );
  const relative = RELATIVE_EVENTS.map((seed) =>
    finalizeEvent(seed, at(base, seed.offsetDays, seed.startsHour), now),
  );
  const events = [...real, ...relative].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // Los dos finalizados más recientes quedan con el cobro pendiente: alimentan la
  // tarea vencida, el aviso de cobro y el saldo del reporte mensual.
  const closed = events.filter((event) => event.status === "COMPLETED");
  for (const event of closed.slice(-2)) event.openBalance = true;

  return events;
}

/**
 * Checklist con avance real (issue #24). La mayoría de los eventos usa el
 * checklist derivado del estado; estos planes fijan a mano el avance de tres
 * casos que la demo tiene que mostrar sin maquillaje:
 *
 * - `activacion_tigo` (próximo): 2 de 4 cumplidas y una tarea vencida.
 * - `showroom_nissei` (próximo): 0 de 4, checklist sin arrancar (riesgo).
 * - `activacion_mall` (en curso): 2 de 4 con la verificación del arranque vencida.
 *
 * Los vencimientos y las completadas se anclan a HOY (`dueInDays`/`doneInDays`),
 * así el avance sigue siendo cierto en cada provisión.
 */
type DemoTaskPlanEntry = {
  key: string;
  type: "SETUP" | "EVENT" | "STRIKE" | "PAYMENT" | "COLLECTION";
  title: string;
  /** Días desde HOY del vencimiento (negativo = ya venció). */
  dueInDays: number;
  dueHour: number;
  /** Días desde HOY en que se completó; `null` = sigue pendiente. */
  doneInDays: number | null;
  promoterId?: string | null;
  notes?: string;
};

const TASK_PLANS: Record<string, readonly DemoTaskPlanEntry[]> = {
  demo_event_activacion_tigo: [
    { key: "acceso", type: "SETUP", title: "Confirmar acceso y habilitación del lugar", dueInDays: -3, dueHour: 12, doneInDays: -4 },
    { key: "compra", type: "PAYMENT", title: "Cerrar la orden de compra con el proveedor", dueInDays: -2, dueHour: 17, doneInDays: -2 },
    { key: "cobro", type: "COLLECTION", title: "Confirmar cobro / saldo con el cliente", dueInDays: -1, dueHour: 12, doneInDays: null, notes: "El cliente todavía no confirmó el saldo (dato simulado)." },
    { key: "evento", type: "EVENT", title: "Verificar equipos y operación del evento", dueInDays: 4, dueHour: 16, doneInDays: null, promoterId: "demo_promoter_lorena", notes: "Asignada a una promotora no disponible: avisar (dato simulado)." },
  ],
  demo_event_showroom_nissei: [
    { key: "montaje", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueInDays: 5, dueHour: 8, doneInDays: null },
    { key: "evento", type: "EVENT", title: "Verificar equipos y operación del evento", dueInDays: 6, dueHour: 11, doneInDays: null, promoterId: "demo_promoter_mabel" },
    { key: "desmontaje", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueInDays: 8, dueHour: 9, doneInDays: null },
    { key: "cobro", type: "COLLECTION", title: "Confirmar cobro / saldo", dueInDays: 9, dueHour: 12, doneInDays: null },
  ],
  demo_event_activacion_mall: [
    { key: "montaje", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueInDays: -1, dueHour: 8, doneInDays: -1, promoterId: "demo_promoter_ana" },
    { key: "anticipo", type: "PAYMENT", title: "Confirmar el anticipo con el cliente", dueInDays: -4, dueHour: 15, doneInDays: -3 },
    { key: "evento", type: "EVENT", title: "Verificar equipos y operación del evento", dueInDays: -1, dueHour: 10, doneInDays: null, notes: "Quedó sin verificar en el arranque (dato simulado).", promoterId: "demo_promoter_ana" },
    { key: "desmontaje", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueInDays: 1, dueHour: 9, doneInDays: null },
  ],
};

/** Tareas del checklist derivadas del estado del evento (4 por evento). */
function buildTasks(event: BuiltEvent, index: number, base: Date): Array<{ id: string; data: Omit<Prisma.EventTaskUncheckedCreateInput, "id"> }> {
  const plan = TASK_PLANS[event.id];
  if (plan) {
    return plan.map((entry) => ({
      id: `demo_task_${event.id.replace(/^demo_event_/, "")}_${entry.key}`,
      data: {
        eventId: event.id,
        type: entry.type,
        title: entry.title,
        dueAt: at(base, entry.dueInDays, entry.dueHour),
        completedAt: entry.doneInDays === null ? null : at(base, entry.doneInDays, entry.dueHour, 30),
        promoterId: entry.promoterId ?? null,
        notes: entry.notes ?? null,
      },
    }));
  }

  const inProgress = event.status === "IN_PROGRESS";
  const done = event.status === "COMPLETED";
  const setupDone = done || inProgress;
  // Promotoras del checklist derivado: solo las disponibles (las no disponibles
  // viven en los planes, para que el aviso sea un caso real y no ruido).
  const promoterId = index % 3 === 0 ? PROMOTER_IDS[0] : index % 3 === 1 ? PROMOTER_IDS[3] : null;
  const milestones: Array<{ key: string; type: "SETUP" | "EVENT" | "STRIKE" | "COLLECTION"; title: string; dueAt: Date; completedAt: Date | null; promoterId?: string | null }> = [
    {
      key: "setup",
      type: "SETUP",
      title: "Confirmar montaje y acceso al lugar",
      dueAt: event.setupAt,
      completedAt: setupDone ? atDay(event.setupAt, 0, 9, 30) : null,
    },
    {
      key: "event",
      type: "EVENT",
      title: "Verificar equipos y operación del evento",
      dueAt: event.startsAt,
      completedAt: done ? plusHours(event.startsAt, 3) : null,
      promoterId,
    },
    {
      key: "strike",
      type: "STRIKE",
      title: "Coordinar desmontaje y devolución",
      dueAt: event.strikeAt,
      completedAt: done ? atDay(event.strikeAt, 0, 12, 30) : null,
    },
    {
      key: "collection",
      type: "COLLECTION",
      title: "Confirmar cobro / saldo",
      dueAt: atDay(event.strikeAt, 1, 12, 0),
      completedAt: done && !event.openBalance ? atDay(event.strikeAt, 2, 15, 0) : null,
    },
  ];
  return milestones.map((milestone) => ({
    id: `demo_task_${event.id.replace(/^demo_event_/, "")}_${milestone.key}`,
    data: {
      eventId: event.id,
      type: milestone.type,
      title: milestone.title,
      dueAt: milestone.dueAt,
      completedAt: milestone.completedAt,
      promoterId: milestone.promoterId ?? null,
      notes: milestone.key === "collection" && event.openBalance ? "Falta cerrar el saldo con el cliente (dato simulado)." : null,
    },
  }));
}


/**
 * Escribe el dataset simulado de la organización demo.
 *
 * Se hace **wipe + alta** dentro de una transacción con advisory lock: el
 * dataset sale siempre canónico (sin filas viejas de versiones anteriores, sin
 * huérfanos) y dos visitantes simultáneos no se pisan. Si algo falla, la
 * transacción no deja la demo a medias: el ancla no se escribe y el siguiente
 * ingreso reintenta.
 */
async function seedDemoData(organizationId: string, base: Date): Promise<void> {
  const org = { organizationId };
  const now = new Date();
  // Identidad de la demo (logos y avatares) generada en el proceso, sin assets
  // externos: se usa para los logos de los clientes y las fotos de promotoras.
  const images = demoIdentityImages();

  const clientsData: Prisma.ClientUncheckedCreateInput[] = CLIENTS.map((client) => {
    const profile = CLIENT_PROFILES[client.id];
    return {
      ...client,
      ...org,
      ruc: null,
      active: true,
      // Datos completos del cliente (issue #36): el contacto del dataset es la
      // persona encargada, con su cargo, contacto directo y links plausibles.
      contactName: client.name,
      contactRole: profile?.contactRole ?? null,
      contactPhone: client.phone,
      contactEmail: contactEmailOf(client),
      website: profile?.website ?? null,
      instagram: profile?.instagram ?? null,
      whatsapp: profile?.whatsapp ?? null,
      createdAt: at(base, -60, 9, 10),
    };
  });

  // Logo de cada cliente: monograma de iniciales con el color de su marca.
  const clientLogosData: Prisma.ClientLogoUncheckedCreateInput[] = [];
  for (const client of CLIENTS) {
    const logo = images.clientLogos.get(client.id);
    if (!logo) continue;
    clientLogosData.push({
      id: `demo_client_logo_${client.id}`,
      clientId: client.id,
      mime: logo.mime,
      size: logo.size,
      width: logo.width,
      height: logo.height,
      data: logo.data,
      createdAt: at(base, -60, 9, 20),
    });
  }

  // ── Eventos con estado derivado por fecha (ventana móvil ±6 meses) ──
  const events = buildEvents(base, now);
  const eventsData: Prisma.EventUncheckedCreateInput[] = events.map((event) => ({
    id: event.id,
    ...org,
    clientId: event.clientId,
    name: event.name,
    location: event.location,
    setupAt: event.setupAt,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    strikeAt: event.strikeAt,
    status: event.status,
    notes: event.notes,
  }));

  const promotersData: Prisma.PromoterUncheckedCreateInput[] = PROMOTERS.map(({ unavailableInDays, initials, accent, ...promoter }) => {
    const photo = images.promoterPhotos.get(promoter.id);
    return {
      ...promoter,
      ...org,
      // Foto generada de la demo (sin assets externos); el avatar único la dibuja.
      photoUrl: photo ? `data:${photo.mime};base64,${Buffer.from(photo.data).toString("base64")}` : null,
      unavailableUntil: unavailableInDays === null ? null : at(base, unavailableInDays, 9, 0),
      createdAt: at(base, -90, 10, 0),
    };
  });

  const tasksData: Prisma.EventTaskUncheckedCreateInput[] = events
    .flatMap((event, index) => buildTasks(event, index, base))
    .map((task) => ({ id: task.id, ...task.data }));

  const suppliersData: Prisma.SupplierUncheckedCreateInput[] = SUPPLIERS.map((supplier) => ({
    ...supplier,
    ...org,
    active: true,
    createdAt: at(base, -120, 9, 0),
  }));

  // ── Eventos por rol: la ventana móvil puede cambiar cuáles son, así que se
  // resuelven por fecha en cada provisión. ──
  const upcoming = events.filter((event) => event.status === "CONFIRMED");
  const past = events.filter((event) => event.status === "COMPLETED");
  const draft = events.find((event) => event.status === "DRAFT");
  const cancelled = events.find((event) => event.status === "CANCELLED");
  const next = upcoming[0];
  const second = upcoming[1];
  const third = upcoming[2];
  const last = upcoming[upcoming.length - 1];
  const recentPast = past[past.length - 1];
  const longestPast = past.reduce((best, event) => (event.durationDays > best.durationDays ? event : best), past[0]);
  const inProgress = events.find((event) => event.status === "IN_PROGRESS");
  if (!next || !second || !third || !last || !recentPast || !longestPast || !draft || !cancelled || !inProgress) {
    throw new Error("La ventana móvil no produjo los eventos esperados para la demo.");
  }
  const pastFiller = past.find((event) => event.id !== longestPast.id && event.id !== recentPast.id) ?? longestPast;
  const eventStart = (event: BuiltEvent, days: number, hour: number, minute = 0) => atDay(event.startsAt, days, hour, minute);

  // ── Trabajos de proveedor en varios estados ──
  // Para eventos muy próximos, el vencimiento se corre a mañana (nunca queda
  // vencido sin querer); los saldos de ferias pasadas vencen hace pocos días.
  const jobDue = (event: BuiltEvent, daysBefore: number, hour: number, minute = 0) => {
    const candidate = eventStart(event, -daysBefore, hour, minute);
    const soonest = at(base, 1, hour, minute);
    return candidate.getTime() > soonest.getTime() ? candidate : soonest;
  };
  const jobsData: Array<Seeded<Prisma.SupplierJobUncheckedCreateInput>> = [
    { id: "demo_job_grafica", ...org, supplierId: "demo_supplier_grafica", eventId: next.id, category: "GRAPHICS", description: `Gráfica del stand · ${next.name}`, total: 2_400_000, advance: 1_200_000, status: "ADVANCE_PAID", dueAt: jobDue(next, 3, 12), notes: "Arte aprobado; retiran antes del montaje." },
    { id: "demo_job_escenario", ...org, supplierId: "demo_supplier_carpinteria", eventId: next.id, category: "CARPENTRY", description: `Escenario y mobiliario · ${next.name}`, total: 5_500_000, advance: 2_000_000, status: "IN_PRODUCTION", dueAt: jobDue(next, 2, 18), notes: "En taller; entrega el día previo al montaje." },
    { id: "demo_job_sonido", ...org, supplierId: "demo_supplier_audio", eventId: second.id, category: "AUDIOVISUAL", description: `Sonido e iluminación · ${second.name}`, total: 3_200_000, advance: 0, status: "CONTRACTED", dueAt: jobDue(second, 5, 9), notes: "Equipo reservado; falta la orden de compra." },
    { id: "demo_job_electrico", ...org, supplierId: "demo_supplier_electricidad", eventId: third.id, category: "ELECTRICITY", description: `Instalación eléctrica y tablero · ${third.name}`, total: 1_500_000, advance: 500_000, status: "IN_PRODUCTION", dueAt: jobDue(third, 4, 9), notes: "Tablero armado en taller." },
    { id: "demo_job_flete_feria", ...org, supplierId: "demo_supplier_transporte", eventId: longestPast.id, category: "TRANSPORT", description: `Flete, montaje y desmontaje · ${longestPast.name}`, total: 1_800_000, advance: 1_800_000, status: "PAID", dueAt: eventStart(longestPast, -2, 8), deliveredAt: eventStart(longestPast, 1, 17), paidAt: eventStart(longestPast, 4, 10), paymentMethod: "Transferencia", receipt: "REC-8812" },
    { id: "demo_job_hogar", ...org, supplierId: "demo_supplier_electricidad", eventId: recentPast.id, category: "ELECTRICITY", description: `Servicio eléctrico · ${recentPast.name}`, total: 1_200_000, advance: 1_200_000, status: "PAID", dueAt: eventStart(recentPast, -1, 6), deliveredAt: eventStart(recentPast, 0, 9), paidAt: pastInstant(withinMonth(base, 4, 15, 0), now), paymentMethod: "Transferencia", receipt: "REC-8820" },
    { id: "demo_job_stand_feria", ...org, supplierId: "demo_supplier_carpinteria", eventId: longestPast.id, category: "FURNITURE", description: `Stands y mobiliario · ${longestPast.name}`, total: 4_100_000, advance: 2_000_000, status: "DELIVERED", dueAt: pastInstant(withinMonth(base, 12, 9, 0), now), deliveredAt: eventStart(longestPast, 1, 7), notes: "Entregado en el predio; falta el saldo." },
    { id: "demo_job_balance", ...org, supplierId: "demo_supplier_audio", eventId: recentPast.id, category: "AUDIOVISUAL", description: `Refuerzo de sonido · ${recentPast.name}`, total: 2_600_000, advance: 1_000_000, status: "BALANCE_PENDING", dueAt: pastInstant(withinMonth(base, 5, 9, 0), now), deliveredAt: eventStart(recentPast, 0, 9), notes: "Saldo pendiente de facturación." },
    { id: "demo_job_lejano", ...org, supplierId: "demo_supplier_grafica", eventId: last.id, category: "GRAPHICS", description: `Vallas y gráfica · ${last.name}`, total: 3_600_000, advance: 0, status: "PENDING", dueAt: jobDue(last, 10, 12), notes: "Esperando el arte final del cliente." },
    // Trabajo atrasado (issue #24): vencido y todavía en producción.
    { id: "demo_job_atraso", ...org, supplierId: "demo_supplier_carpinteria", eventId: next.id, category: "CARPENTRY", description: `Escenografía y mobiliario · ${next.name}`, total: 3_100_000, advance: 1_000_000, status: "IN_PRODUCTION", dueAt: at(base, -3, 12), notes: "Atrasado: el taller prometió entregar hace dos días y todavía no avisó." },
  ];

  // ── Presupuestos por rol (aprobado por portal, pendiente con link+QR, cambios pedidos) ──
  const budgetSeeds: Array<{
    id: string;
    event: BuiltEvent;
    title: string;
    status: "APPROVED" | "SENT" | "NEGOTIATING" | "DRAFT" | "LOST";
    discount: number;
    validUntil: Date;
    notes: string;
    token?: string;
    tokenCreatedAt?: Date;
    approval?: { at: Date; byName: string; method: "digital" | "manual"; ip?: string; userAgent?: string; note: string };
    revision?: { at: Date; note: string };
    /**
     * Plan de pagos (issue #14): anticipo y cuotas. Las cuotas se vencen en días
     * relativos a HOY (`dueInDays`) o en una fecha absoluta (`dueAt`, para los
     * presupuestos ya cerrados), así el re-anclaje nunca deja cuotas raras.
     */
    plan?: {
      advance: number;
      terms: string;
      installments: Array<{ label: string; amount: number; dueInDays?: number; dueAt?: Date }>;
    };
    createdAt: Date;
    items: Array<{ id: string; name: string; quantity: number; days: number; unitPrice: number; costPrice: number }>;
  }> = [
    {
      id: "demo_budget_aprobado",
      event: next,
      title: `Producción integral ${next.name}`,
      status: "APPROVED",
      discount: 1_620_000,
      validUntil: eventStart(next, -2, 18),
      notes: "Incluye pantallas, estructura y operación técnica. Montaje el día previo.",
      plan: {
        advance: 9_234_000,
        terms:
          "Anticipo del 30% para reservar la fecha; el saldo en dos cuotas iguales a 21 y 45 días de la aprobación. Transferencia a la cuenta de la empresa.",
        installments: [
          { label: "Cuota 1 · saldo", amount: 10_773_000, dueInDays: 21 },
          { label: "Cuota 2 · saldo final", amount: 10_773_000, dueInDays: 45 },
        ],
      },
      token: "D3M9-5G97-4XKW-2M8R-T3HN",
      tokenCreatedAt: at(base, -12, 10, 0),
      approval: {
        at: pastInstant(withinMonth(base, 5, 16, 30), now),
        byName: clientContact(next.clientId).name,
        method: "digital",
        ip: "190.10.20.30",
        userAgent: "Mozilla/5.0 (Linux; Android 14; LedBox Demo)",
        note: "Aprobado; mantengan el horario de montaje del día previo.",
      },
      createdAt: at(base, -14, 11, 5),
      items: [
        { id: "demo_budget_item_a1", name: "Pantalla LED P3.9 500x500 (m²)", quantity: 20, days: 1, unitPrice: 950_000, costPrice: 380_000 },
        { id: "demo_budget_item_a2", name: "Tótem LED 2x1 m", quantity: 2, days: 1, unitPrice: 1_800_000, costPrice: 700_000 },
        { id: "demo_budget_item_a3", name: "Sonido e iluminación de escenario", quantity: 1, days: 1, unitPrice: 6_500_000, costPrice: 3_000_000 },
        { id: "demo_budget_item_a4", name: "Operación técnica y montaje", quantity: 1, days: 2, unitPrice: 1_650_000, costPrice: 600_000 },
      ],
    },
    {
      id: "demo_budget_pendiente",
      event: second,
      title: `Alquiler de pantallas ${second.name}`,
      status: "SENT",
      discount: 0,
      validUntil: eventStart(second, -1, 18),
      notes: "Pendiente de aprobación del cliente; link y QR activos para decidir online.",
      plan: {
        advance: 4_440_000,
        terms: "Anticipo del 30% para reservar los equipos; saldo a 30 días de la aprobación.",
        installments: [{ label: "Saldo · 30 días", amount: 10_360_000, dueInDays: 30 }],
      },
      token: "D3M9-F3R4-A2PY-Q7SC-K4VT",
      tokenCreatedAt: at(base, -3, 9, 15),
      createdAt: at(base, -6, 9, 20),
      items: [
        { id: "demo_budget_item_b1", name: "Pantalla LED P5 outdoor 960x960", quantity: 6, days: 2, unitPrice: 800_000, costPrice: 320_000 },
        { id: "demo_budget_item_b2", name: "Estructura de truss 2 m", quantity: 10, days: 2, unitPrice: 200_000, costPrice: 80_000 },
        { id: "demo_budget_item_b3", name: "Operación técnica", quantity: 1, days: 2, unitPrice: 600_000, costPrice: 250_000 },
      ],
    },
    {
      id: "demo_budget_cambios",
      event: third,
      title: `Stands y pantallas ${third.name}`,
      status: "NEGOTIATING",
      discount: 300_000,
      validUntil: eventStart(third, 2, 18),
      notes: "El cliente pidió mover el montaje y sumar dos tótems touch.",
      token: "D3M9-B4NK-5T4N-D8XM-J2QZ",
      tokenCreatedAt: at(base, -8, 10, 30),
      revision: { at: pastInstant(at(base, -1, 11, 20), now), note: "Necesitamos mover el montaje y sumar dos tótems touch." },
      createdAt: at(base, -10, 15, 40),
      items: [
        { id: "demo_budget_item_c1", name: "Stand modular 3x3 m", quantity: 2, days: 2, unitPrice: 1_900_000, costPrice: 800_000 },
        { id: "demo_budget_item_c2", name: "Tótem Touch 43\"", quantity: 1, days: 2, unitPrice: 1_100_000, costPrice: 450_000 },
      ],
    },
    {
      id: "demo_budget_cobrado",
      event: longestPast,
      title: `Cierre de feria ${longestPast.name}`,
      status: "APPROVED",
      discount: 0,
      validUntil: eventStart(longestPast, -8, 18),
      notes: "Aprobado por correo y confirmado por teléfono; cobrado en su totalidad.",
      plan: {
        advance: 6_250_000,
        terms: "Anticipo del 50% y saldo contra entrega en el predio.",
        installments: [{ label: "Saldo contra entrega", amount: 6_250_000, dueAt: atDay(longestPast.endsAt, 0, 12) }],
      },
      approval: {
        at: eventStart(longestPast, -12, 10, 0),
        byName: clientContact(longestPast.clientId).name,
        method: "manual",
        note: "Confirmado por teléfono; se emite la orden de trabajo.",
      },
      createdAt: eventStart(longestPast, -18, 9, 30),
      items: [
        { id: "demo_budget_item_d1", name: "Pantalla LED P3.9 500x500", quantity: 10, days: 1, unitPrice: 800_000, costPrice: 340_000 },
        { id: "demo_budget_item_d2", name: "Sonido profesional", quantity: 1, days: 1, unitPrice: 3_000_000, costPrice: 1_300_000 },
        { id: "demo_budget_item_d3", name: "Operación técnica", quantity: 1, days: 2, unitPrice: 750_000, costPrice: 300_000 },
      ],
    },
    {
      id: "demo_budget_borrador",
      event: draft,
      title: `Activación de verano ${draft.location.split(",")[0]}`,
      status: "DRAFT",
      discount: 0,
      validUntil: eventStart(draft, 6, 18),
      notes: "Borrador a la espera de la habilitación municipal.",
      createdAt: at(base, -3, 16, 10),
      items: [
        { id: "demo_budget_item_e1", name: "Cilindro LED 1.5 m", quantity: 4, days: 3, unitPrice: 950_000, costPrice: 380_000 },
        { id: "demo_budget_item_e2", name: "Dispensador inteligente", quantity: 1, days: 3, unitPrice: 600_000, costPrice: 240_000 },
      ],
    },
    // Mora (issue #24): presupuesto aprobado con dos cuotas vencidas, una de
    // ellas re-emitida tras el rechazo del cheque. El cliente queda con deuda
    // vencida visible en Clientes y en Finanzas.
    {
      id: "demo_budget_mora",
      event: recentPast,
      title: `Alquiler de pantallas ${recentPast.name}`,
      status: "APPROVED",
      discount: 0,
      validUntil: at(base, -8, 18),
      notes: "Saldo a plazo; el cheque de la cuota 1 rebotó y se re-emitió el cobro.",
      plan: {
        advance: 3_000_000,
        terms: "Anticipo del 40% con la orden de trabajo; saldo en dos cuotas a 30 y 45 días.",
        installments: [
          { label: "Cuota 1 · saldo", amount: 4_000_000, dueInDays: -14 },
          { label: "Cuota 2 · saldo final", amount: 4_000_000, dueInDays: -5 },
        ],
      },
      approval: {
        at: eventStart(recentPast, -9, 10, 0),
        byName: clientContact(recentPast.clientId).name,
        method: "manual",
        note: "Confirmado por correo; se emite la orden de trabajo.",
      },
      createdAt: eventStart(recentPast, -12, 9, 0),
      items: [
        { id: "demo_budget_item_f1", name: "Pantalla LED P5 outdoor 960x960", quantity: 6, days: 2, unitPrice: 800_000, costPrice: 320_000 },
        { id: "demo_budget_item_f2", name: "Operación técnica", quantity: 1, days: 2, unitPrice: 700_000, costPrice: 280_000 },
      ],
    },
    // Perdido (issue #24): el evento cancelado dejó el presupuesto sin cerrar.
    {
      id: "demo_budget_perdido",
      event: cancelled,
      title: `Producción ${cancelled.name.split("·")[0].trim()}`,
      status: "LOST",
      discount: 0,
      validUntil: at(base, -3, 18),
      notes: "El cliente postergó la campaña para noviembre y eligió otro proveedor para esa fecha.",
      createdAt: at(base, -20, 10, 30),
      items: [
        { id: "demo_budget_item_g1", name: "Pasarela y estructura", quantity: 1, days: 2, unitPrice: 12_500_000, costPrice: 5_200_000 },
        { id: "demo_budget_item_g2", name: "Pantalla LED de fondo", quantity: 8, days: 2, unitPrice: 850_000, costPrice: 340_000 },
      ],
    },
  ];

  const budgetTotals = new Map<string, number>();
  const budgetsData: Prisma.BudgetUncheckedCreateInput[] = [];
  const budgetItemsData: Prisma.BudgetItemUncheckedCreateInput[] = [];
  for (const budget of budgetSeeds) {
    const subtotal = budget.items.reduce((sum, item) => sum + item.quantity * item.days * item.unitPrice, 0);
    const costEstimate = budget.items.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
    const total = Math.max(0, subtotal - budget.discount);
    budgetTotals.set(budget.id, total);
    // Plan de pagos: anticipo + cuotas con vencimientos relativos a hoy (o al
    // evento en los presupuestos ya cerrados).
    const todayKey = dayKeyOf(new Date());
    const advanceAmount = budget.plan?.advance ?? 0;
    const installments = (budget.plan?.installments ?? []).map((installment) => ({
      label: installment.label,
      amount: installment.amount,
      dueAt: installment.dueAt ? dayKeyOf(installment.dueAt) : shiftDayKey(todayKey, installment.dueInDays ?? 0),
    }));
    const committed = advanceAmount + installments.reduce((sum, installment) => sum + installment.amount, 0);
    if (committed > total) throw new Error(`El plan de pagos de ${budget.id} supera el total del presupuesto.`);
    budgetsData.push({
      id: budget.id,
      ...org,
      clientId: budget.event.clientId,
      eventId: budget.event.id,
      title: budget.title,
      status: budget.status,
      subtotal,
      discount: budget.discount,
      total,
      costEstimate,
      advanceAmount,
      paymentTerms: budget.plan?.terms ?? null,
      installmentsJson: installments.length > 0 ? (installments as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      validUntil: budget.validUntil,
      notes: budget.notes,
      publicToken: budget.token ?? null,
      publicTokenCreatedAt: budget.tokenCreatedAt ?? null,
      approvedAt: budget.approval?.at ?? null,
      approvedByName: budget.approval?.byName ?? null,
      approvalMethod: budget.approval?.method ?? null,
      approvalIp: budget.approval?.ip ?? null,
      approvalUserAgent: budget.approval?.userAgent ?? null,
      approvalNote: budget.approval?.note ?? null,
      revisionRequestedAt: budget.revision?.at ?? null,
      revisionNote: budget.revision?.note ?? null,
      createdAt: budget.createdAt,
    });
    for (const item of budget.items) {
      budgetItemsData.push({
        id: item.id,
        budgetId: budget.id,
        name: item.name,
        quantity: item.quantity,
        days: item.days,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        subtotal: item.quantity * item.days * item.unitPrice,
      });
    }
  }

  // ── Solicitudes del portal (issue #14): una rebaja aceptada, una rechazada y
  // una propuesta de ítems pendiente en el presupuesto que se comparte para
  // probar la autogestión. ──
  const nextContact = clientContact(next.clientId);
  const secondContact = clientContact(second.clientId);
  const changeRequestsData: Prisma.BudgetChangeRequestUncheckedCreateInput[] = [
    {
      id: "demo_request_rebaja_aceptada",
      ...org,
      budgetId: "demo_budget_aprobado",
      kind: "discount",
      status: "accepted",
      payload: { discount: { type: "percent", value: 5, amount: 1_620_000 } } as unknown as Prisma.InputJsonValue,
      note: "Pedimos 5% de descuento para cerrar hoy.",
      requestedByName: nextContact.name,
      requestedByEmail: nextContact.email,
      createdAt: at(base, -9, 15, 10),
      resolvedAt: at(base, -8, 10, 5),
      resolvedByName: "Valeria Ortiz",
      responseNote: "Aprobado: 5% sobre el subtotal, ya aplicado al presupuesto.",
    },
    {
      id: "demo_request_rebaja_rechazada",
      ...org,
      budgetId: "demo_budget_aprobado",
      kind: "discount",
      status: "rejected",
      payload: { discount: { type: "percent", value: 12, amount: 3_888_000 } } as unknown as Prisma.InputJsonValue,
      note: "Nos ofrecieron 12% en otra propuesta; ¿pueden igualarlo?",
      requestedByName: nextContact.name,
      requestedByEmail: nextContact.email,
      createdAt: at(base, -6, 9, 40),
      resolvedAt: at(base, -5, 16, 20),
      resolvedByName: "Valeria Ortiz",
      responseNote: "No llegamos a ese descuento: el margen del evento está ajustado. Sumamos un tótem sin cargo.",
    },
    {
      id: "demo_request_items_pendiente",
      ...org,
      budgetId: "demo_budget_pendiente",
      kind: "items",
      status: "pending",
      payload: {
        items: [
          { id: "demo_budget_item_b1", quantity: 8, days: 2 },
          { id: "demo_budget_item_b2", quantity: 10, days: 2 },
          { id: "demo_budget_item_b3", quantity: 1, days: 3 },
        ],
      } as unknown as Prisma.InputJsonValue,
      note: "Sumamos dos pantallas más y un día de operación para la transmisión.",
      requestedByName: secondContact.name,
      requestedByEmail: secondContact.email,
      createdAt: at(base, -1, 10, 15),
    },
  ];

  // ── Cobros: los cobrados del mes y la cuota 1 del plan aprobado a plazo ──
  // Cada cobro recibido declara **en qué cuenta entró** (issue #27): de ahí sale
  // su movimiento de tesorería, que es lo que mueve el saldo derivado.
  const totalOf = (id: string) => budgetTotals.get(id) ?? 0;
  const paidOf = totalOf("demo_budget_cobrado");
  const planOf = (id: string) => budgetSeeds.find((budget) => budget.id === id)?.plan;
  const nextPlan = planOf("demo_budget_aprobado");
  const nextInstallment = nextPlan?.installments[0]?.amount ?? 0;
  const received = (
    id: string,
    data: Omit<Prisma.ClientPaymentUncheckedCreateInput, "id" | "organizationId" | "status" | "collectedAt" | "treasuryAccountId">,
    treasuryAccountId: string,
  ) => ({
    id,
    ...org,
    ...data,
    treasuryAccountId,
    status: "RECEIVED" as const,
    collectedAt: data.paidAt ?? null,
  });
  const paymentsData: Array<Seeded<Prisma.ClientPaymentUncheckedCreateInput>> = [
    received("demo_pay_cobrado_1", { clientId: longestPast.clientId, budgetId: "demo_budget_cobrado", amount: Math.round(paidOf / 2), paidAt: eventStart(longestPast, -10, 9, 40), method: "Transferencia", reference: "TRF-87990", notes: "Anticipo del cierre de feria." }, "demo_treasury_ueno"),
    received("demo_pay_cobrado_2", { clientId: longestPast.clientId, budgetId: "demo_budget_cobrado", amount: paidOf - Math.round(paidOf / 2), paidAt: eventStart(longestPast, 2, 17, 10), method: "Transferencia", reference: "TRF-88105", notes: "Cancelación total." }, "demo_treasury_ueno"),
    // La seña con cheque entra a «Cheques a cobrar» y después se cobra en
    // efectivo: la transferencia ya hecha es la que mueve la plata a caja.
    received("demo_pay_cambios", { clientId: third.clientId, budgetId: "demo_budget_cambios", amount: 2_000_000, paidAt: pastInstant(withinMonth(base, 8, 16, 0), now), method: "Cheque", reference: "CHQ-4471", notes: "Seña; el saldo se ajusta con los cambios pedidos." }, "demo_treasury_cheques"),
    received("demo_pay_aprobado", { clientId: next.clientId, budgetId: "demo_budget_aprobado", amount: nextPlan?.advance ?? 0, paidAt: pastInstant(withinMonth(base, 6, 15, 30), now), method: "Transferencia", reference: "TRF-88213", notes: "Anticipo del plan de pagos aprobado." }, "demo_treasury_ueno"),
    // Seña del presupuesto pendiente: cheque a vencer, todavía en cartera.
    received("demo_pay_pendiente", { clientId: second.clientId, budgetId: "demo_budget_pendiente", amount: 4_000_000, paidAt: pastInstant(withinMonth(base, 3, 11, 0), now), method: "Cheque", reference: "CHQ-4488", chequeDate: at(base, 26, 12, 0), notes: "Seña para reservar los equipos; cheque a vencer." }, "demo_treasury_cheques"),
    // Cobro a plazo (issue #16): la cuota 1 del plan aprobado, con vencimiento
    // próximo; se re-ancla a hoy en cada provisión.
    {
      id: "demo_pay_cuota_1",
      ...org,
      clientId: next.clientId,
      budgetId: "demo_budget_aprobado",
      amount: nextInstallment,
      status: "PENDING",
      paidAt: null,
      collectedAt: null,
      method: "Transferencia",
      dueAt: at(base, 21, 12, 0),
      invoiceNumber: "FAC-2026-0184",
      invoiceIssuedAt: pastInstant(at(base, -4, 10, 0), now),
      notes: "Cuota 1 del plan de pagos aprobado.",
    },
    // ── Mora (issue #24): anticipo cobrado, cheque rechazado (anulado) y dos
    // cuotas vencidas que quedan pendientes. El saldo vencido del cliente sale
    // de acá, no de un campo nuevo. ──
    received("demo_pay_mora_anticipo", {
      clientId: recentPast.clientId,
      budgetId: "demo_budget_mora",
      amount: 3_000_000,
      paidAt: eventStart(recentPast, -10, 9, 30),
      method: "Transferencia",
      reference: "TRF-87942",
      notes: "Anticipo del 40% con la orden de trabajo.",
    }, "demo_treasury_ueno"),
    {
      id: "demo_pay_mora_cheque",
      ...org,
      clientId: recentPast.clientId,
      budgetId: "demo_budget_mora",
      amount: 4_000_000,
      status: "CANCELLED",
      paidAt: null,
      collectedAt: null,
      method: "Cheque",
      reference: "CHQ-5502",
      dueAt: at(base, -21, 12, 0),
      chequeDate: at(base, -21, 12, 0),
      notes: "Cheque rechazado por el banco: el cobro se anuló y se re-emitió por transferencia.",
    },
    {
      id: "demo_pay_mora_cuota_1",
      ...org,
      clientId: recentPast.clientId,
      budgetId: "demo_budget_mora",
      amount: 4_000_000,
      status: "PENDING",
      paidAt: null,
      collectedAt: null,
      method: "Transferencia",
      dueAt: at(base, -14, 12, 0),
      invoiceNumber: "FAC-2026-0179",
      invoiceIssuedAt: pastInstant(at(base, -21, 9, 0), now),
      notes: "Cuota 1 vencida: se re-emitió tras el rechazo del cheque.",
    },
    {
      id: "demo_pay_mora_cuota_2",
      ...org,
      clientId: recentPast.clientId,
      budgetId: "demo_budget_mora",
      amount: 4_000_000,
      status: "PENDING",
      paidAt: null,
      collectedAt: null,
      method: "Transferencia",
      dueAt: at(base, -5, 12, 0),
      invoiceNumber: "FAC-2026-0179",
      invoiceIssuedAt: pastInstant(at(base, -21, 9, 0), now),
      notes: "Cuota 2 vencida: el cliente pidió refinanciar.",
    },
  ];

  // ── Gastos (issue #27): cada uno con su categoría, su cuenta y su egreso.
  // Los dos sin proyecto quedan «A definir» a propósito. ──
  const eventByRole = { next, second, inProgress, recentPast, longestPast } as const;
  const expensesData: Array<Seeded<Prisma.ExpenseUncheckedCreateInput>> = EXPENSES.map((expense) => ({
    id: expense.id,
    ...org,
    accountId: expense.accountId,
    eventId: expense.eventRole ? eventByRole[expense.eventRole].id : null,
    supplierId: expense.supplierId,
    date: at(base, -expense.daysAgo, 0, 0),
    amount: expense.amount,
    category: expense.category,
    description: expense.description,
    method: expense.method,
    receipt: expense.receipt,
    notes: expense.notes,
    createdById: ACTORS.ops.id,
    createdByName: ACTORS.ops.name,
    createdByEmail: ACTORS.ops.email,
    createdAt: at(base, -expense.daysAgo, expense.hour, 0),
  }));

  // ── Tesorería (issue #27): las cuentas viven de sus movimientos. Cada
  // movimiento nace de un hecho real del dataset —cobro recibido, pago o
  // anticipo a un proveedor, gasto— o de la transferencia del cheque ya cobrado
  // en efectivo; el saldo se deriva, nunca se guarda. ──
  const clientLabelOf = (clientId: string) => {
    const client = CLIENT_BY_ID.get(clientId);
    return client ? clientLabel({ name: client.name, company: client.company }) : "Cliente";
  };
  const supplierNameOf = (supplierId: string | null) => SUPPLIERS.find((supplier) => supplier.id === supplierId)?.name ?? "Proveedor";
  const movement = (
    id: string,
    accountId: string,
    direction: "IN" | "OUT" | "TRANSFER",
    amount: number,
    occurredAt: Date,
    origin: "client_payment" | "supplier_job" | "expense" | "adjustment",
    sourceId: string | null,
    label: string | null,
    ref: string | null,
    options?: { counterAccountId?: string; notes?: string | null },
  ): Seeded<Prisma.TreasuryMovementUncheckedCreateInput> => ({
    id,
    ...org,
    accountId,
    counterAccountId: options?.counterAccountId ?? null,
    direction,
    amount,
    occurredAt,
    origin,
    sourceId,
    // Snapshot del hecho (issue #20): la etiqueta del momento manda en la lista.
    sourceSnapshot:
      label && origin !== "adjustment"
        ? ({ kind: origin, label, amount, ref } as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    notes: options?.notes ?? null,
    createdById: ACTORS.sales.id,
    createdByName: ACTORS.sales.name,
    createdByEmail: ACTORS.sales.email,
    createdAt: occurredAt,
  });
  const treasuryMovementsData: Array<Seeded<Prisma.TreasuryMovementUncheckedCreateInput>> = [
    // Entradas: cada cobro recibido, en la cuenta que declara.
    ...paymentsData
      .filter((payment) => payment.status === "RECEIVED" && payment.treasuryAccountId)
      .map((payment) =>
        movement(
          `demo_tm_${payment.id}`,
          payment.treasuryAccountId as string,
          "IN",
          payment.amount,
          dateOf(payment.paidAt, base),
          "client_payment",
          payment.id,
          clientLabelOf(payment.clientId),
          payment.reference ?? payment.method ?? null,
          { notes: payment.notes ?? null },
        ),
      ),
    // Salidas: anticipos y pagos a proveedores ya hechos (monto = anticipo real).
    ...jobsData
      .filter((job) => (job.advance ?? 0) > 0)
      .map((job) =>
        movement(
          `demo_tm_${job.id}`,
          "demo_treasury_ueno",
          "OUT",
          job.advance ?? 0,
          pastInstant(dateOf(job.paidAt ?? job.deliveredAt ?? job.dueAt, base), now),
          "supplier_job",
          job.id,
          `${supplierNameOf(job.supplierId)} · ${job.description}`,
          job.receipt ?? job.paymentMethod ?? null,
        ),
      ),
    // Salidas: cada gasto carga su egreso (el gasto y su movimiento no se separan).
    ...expensesData.map((expense) =>
      movement(
        `demo_tm_${expense.id}`,
        expense.accountId,
        "OUT",
        expense.amount,
        dateOf(expense.date, base),
        "expense",
        expense.id,
        expense.description,
        expense.receipt ?? expense.method ?? null,
      ),
    ),
    // La transferencia ya hecha: el cheque de la seña se cobró y la plata pasó a caja.
    movement(
      "demo_tm_transfer_cheque",
      "demo_treasury_cheques",
      "TRANSFER",
      DEMO_CHEQUE_TRANSFER_AMOUNT,
      pastInstant(at(base, -4, 11, 15), now),
      "adjustment",
      null,
      null,
      null,
      { counterAccountId: "demo_treasury_cash", notes: "Cheque cobrado en efectivo: se acredita en caja." },
    ),
  ];

  // ── Pagos esperados del plan (issue #28): comprobante en revisión, vencido sin
  // comprobante y confirmado con su cobro y movimiento. Los montos y los
  // vencimientos salen del plan real de cada presupuesto. ──
  const paymentById = new Map(paymentsData.map((payment) => [payment.id, payment]));
  const paidAtOf = (id: string) => dateOf(paymentById.get(id)?.paidAt, at(base, -5, 12, 0));
  const dayOf = (date: Date) => dayStart(dayKeyOf(date));
  const proofImage = demoIdentityImages().proof;
  const proofsData: Prisma.BudgetPaymentProofUncheckedCreateInput[] = [
    {
      id: "demo_proof_mora_cuota_1",
      organizationId,
      budgetId: "demo_budget_mora",
      paymentId: null,
      uploadedByName: clientContact(recentPast.clientId).name,
      mime: proofImage.mime,
      size: proofImage.size,
      data: proofImage.data,
      createdAt: at(base, -3, 10, 45),
    },
  ];
  const expectedPaymentsData: Prisma.ExpectedPaymentUncheckedCreateInput[] = [
    {
      id: "demo_expected_aprobado_advance",
      ...org,
      budgetId: "demo_budget_aprobado",
      concept: "advance",
      slot: "advance",
      installmentNumber: null,
      label: "Anticipo",
      amount: nextPlan?.advance ?? 0,
      dueAt: dayOf(paidAtOf("demo_pay_aprobado")),
      status: "CONFIRMED",
      expectedAccountId: "demo_treasury_ueno",
      paymentId: "demo_pay_aprobado",
      confirmedAt: paidAtOf("demo_pay_aprobado"),
      confirmedById: ACTORS.sales.id,
      confirmedByName: ACTORS.sales.name,
      confirmedByEmail: ACTORS.sales.email,
      notes: "Anticipo del plan aprobado, confirmado en Ueno Bank.",
      createdAt: at(base, -6, 9, 20),
    },
    {
      id: "demo_expected_aprobado_cuota_1",
      ...org,
      budgetId: "demo_budget_aprobado",
      concept: "installment",
      slot: "installment:1",
      installmentNumber: 1,
      label: "Cuota 1 · saldo",
      amount: nextPlan?.installments[0]?.amount ?? 0,
      dueAt: at(base, 21, 0, 0),
      status: "AWAITING",
      expectedAccountId: "demo_treasury_ueno",
      notes: "Cuota 1 del plan; el cobro a plazo ya está emitido.",
      createdAt: at(base, -6, 9, 20),
    },
    {
      id: "demo_expected_aprobado_cuota_2",
      ...org,
      budgetId: "demo_budget_aprobado",
      concept: "installment",
      slot: "installment:2",
      installmentNumber: 2,
      label: "Cuota 2 · saldo final",
      amount: nextPlan?.installments[1]?.amount ?? 0,
      dueAt: at(base, 45, 0, 0),
      status: "AWAITING",
      expectedAccountId: "demo_treasury_ueno",
      createdAt: at(base, -6, 9, 20),
    },
    {
      id: "demo_expected_mora_advance",
      ...org,
      budgetId: "demo_budget_mora",
      concept: "advance",
      slot: "advance",
      installmentNumber: null,
      label: "Anticipo",
      amount: 3_000_000,
      dueAt: dayOf(paidAtOf("demo_pay_mora_anticipo")),
      status: "CONFIRMED",
      expectedAccountId: "demo_treasury_ueno",
      paymentId: "demo_pay_mora_anticipo",
      confirmedAt: paidAtOf("demo_pay_mora_anticipo"),
      confirmedById: ACTORS.sales.id,
      confirmedByName: ACTORS.sales.name,
      confirmedByEmail: ACTORS.sales.email,
      notes: "Anticipo del 40% cobrado con la orden de trabajo.",
      createdAt: eventStart(recentPast, -12, 9, 0),
    },
    // El cliente subió el comprobante y todavía no se confirmó: el equipo lo
    // está revisando (el importe no coincide con la cuota).
    {
      id: "demo_expected_mora_cuota_1",
      ...org,
      budgetId: "demo_budget_mora",
      concept: "installment",
      slot: "installment:1",
      installmentNumber: 1,
      label: "Cuota 1 · saldo",
      amount: 4_000_000,
      dueAt: at(base, -14, 0, 0),
      status: "PROOF",
      expectedAccountId: "demo_treasury_ueno",
      proofId: "demo_proof_mora_cuota_1",
      notes: "El comprobante llegó desde el portal y quedó en revisión; el importe no coincide con la cuota (faltan Gs. 150.000).",
      createdAt: eventStart(recentPast, -12, 9, 0),
    },
    // Vencida y sin comprobante: la deuda vencida real del cliente.
    {
      id: "demo_expected_mora_cuota_2",
      ...org,
      budgetId: "demo_budget_mora",
      concept: "installment",
      slot: "installment:2",
      installmentNumber: 2,
      label: "Cuota 2 · saldo final",
      amount: 4_000_000,
      dueAt: at(base, -5, 0, 0),
      status: "AWAITING",
      expectedAccountId: "demo_treasury_ueno",
      notes: "Vencida y sin comprobante: el cliente pidió refinanciar.",
      createdAt: eventStart(recentPast, -12, 9, 0),
    },
    {
      id: "demo_expected_cobrado_advance",
      ...org,
      budgetId: "demo_budget_cobrado",
      concept: "advance",
      slot: "advance",
      installmentNumber: null,
      label: "Anticipo",
      amount: 6_250_000,
      dueAt: dayOf(paidAtOf("demo_pay_cobrado_1")),
      status: "CONFIRMED",
      expectedAccountId: "demo_treasury_ueno",
      paymentId: "demo_pay_cobrado_1",
      confirmedAt: paidAtOf("demo_pay_cobrado_1"),
      confirmedById: ACTORS.sales.id,
      confirmedByName: ACTORS.sales.name,
      confirmedByEmail: ACTORS.sales.email,
      notes: "Anticipo del 50% cobrado antes del montaje.",
      createdAt: eventStart(longestPast, -18, 9, 30),
    },
    {
      id: "demo_expected_cobrado_balance",
      ...org,
      budgetId: "demo_budget_cobrado",
      concept: "balance",
      slot: "balance",
      installmentNumber: null,
      label: "Saldo contra entrega",
      amount: 6_250_000,
      dueAt: dayOf(paidAtOf("demo_pay_cobrado_2")),
      status: "CONFIRMED",
      expectedAccountId: "demo_treasury_ueno",
      paymentId: "demo_pay_cobrado_2",
      confirmedAt: paidAtOf("demo_pay_cobrado_2"),
      confirmedById: ACTORS.sales.id,
      confirmedByName: ACTORS.sales.name,
      confirmedByEmail: ACTORS.sales.email,
      notes: "Saldo contra entrega en el predio.",
      createdAt: eventStart(longestPast, -18, 9, 30),
    },
  ];

  // ── Historial de correos (issue #30): presupuesto enviado, recordatorio,
  // prueba, un fallo con su motivo y la invitación. ──
  const pendingBudget = budgetsData.find((budget) => budget.id === "demo_budget_pendiente");
  const pendingBudgetSeed = budgetSeeds.find((budget) => budget.id === "demo_budget_pendiente");
  const moraClient = clientContact(recentPast.clientId);
  const moraClientRecord = CLIENT_BY_ID.get(recentPast.clientId);
  const moraDue1 = at(base, -14, 0, 0);
  const moraDue2 = at(base, -5, 0, 0);
  const moraBudgetTitle = budgetSeeds.find((budget) => budget.id === "demo_budget_mora")?.title ?? "Presupuesto";
  /** Cuenta regresiva del vencimiento, con el mismo texto que el recordatorio real. */
  const dueCountdown = (dueAt: Date) => {
    const days = Math.round((dayStart(dayKeyOf(dueAt)).getTime() - dayStart(dayKeyOf(base)).getTime()) / DAY_MS);
    return days === 0 ? "vence hoy" : days === 1 ? "vence mañana" : days === -1 ? "venció ayer" : days > 0 ? `vence en ${formatNumber(days)} días` : `venció hace ${formatNumber(Math.abs(days))} días`;
  };
  // Los recordatorios del dataset son de pagos esperados: el concepto del asunto
  // es el mismo que arma el envío real (`<concepto> del presupuesto «…»`).
  const reminderSubject = (label: string, dueAt: Date) =>
    `Recordatorio de pago · ${label} del presupuesto «${moraBudgetTitle}» · ${dueCountdown(dueAt)} el ${formatDate(dueAt)}`;
  const mailSubjects: Record<string, string> = {
    demo_mail_budget: `Presupuesto «${pendingBudgetSeed?.title ?? "Presupuesto"}» · ${formatMoney(pendingBudget?.total ?? 0)}${
      pendingBudgetSeed?.validUntil ? ` · válido hasta el ${formatDate(pendingBudgetSeed.validUntil)}` : ""
    }`,
    demo_mail_reminder_mora_1: reminderSubject("Cuota 1 · saldo", moraDue1),
    demo_mail_reminder_mora_2: reminderSubject("Cuota 2 · saldo final", moraDue2),
  };
  const mailRecipients: Record<DemoMailLog["to"], string> = {
    pendingBudgetClient: secondContact.email,
    moraClient: moraClient.email,
    valeria: DEMO_INVITER.email,
    invited: "rocio.benitez@ledbox.demo",
    demoUser: DEMO_USER_EMAIL,
  };
  const mailLogsData: Prisma.MailLogUncheckedCreateInput[] = MAIL_LOGS.map((log) => {
    const actor = log.actor === "system" ? { id: "system", name: "Recordatorios automáticos", email: null } : { ...ACTORS.sales, email: ACTORS.sales.email };
    return {
      id: log.id,
      organizationId,
      category: log.category,
      status: log.status,
      to: mailRecipients[log.to],
      subject: mailSubjects[log.id] ?? log.subject,
      error: log.error,
      providerId: log.status === "sent" ? `demo-${log.id}` : null,
      entity: log.entity,
      entityId: log.entityId,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      sentAt: at(base, -log.daysAgo, log.hour, log.minute),
      createdAt: at(base, -log.daysAgo, log.hour, log.minute),
    };
  });
  // Bitácora del recordatorio (issue #19): un envío por cobro, canal y día.
  const reminderLogsData: Prisma.PaymentReminderLogUncheckedCreateInput[] = [
    {
      id: "demo_reminder_mora_cuota_1",
      organizationId,
      paymentId: "demo_pay_mora_cuota_1",
      expectedPaymentId: "demo_expected_mora_cuota_1",
      targetKey: "expected:demo_expected_mora_cuota_1",
      channel: "email",
      status: "sent",
      to: moraClient.email,
      dayKey: dayKeyOf(at(base, -2, 8, 5)),
      subject: mailSubjects.demo_mail_reminder_mora_1,
      actorKind: "system",
      actorId: null,
      actorName: "Recordatorios automáticos",
      actorEmail: null,
      sentAt: at(base, -2, 8, 5),
      createdAt: at(base, -2, 8, 5),
    },
  ];

  // ── Invitaciones al equipo (issue #31) ──
  const invitationsData: Prisma.TeamInvitationUncheckedCreateInput[] = INVITATIONS.map((invitation) => ({
    id: invitation.id,
    ...org,
    email: invitation.email,
    role: invitation.role,
    // El token plano solo vive en el link del correo: acá se guarda su hash.
    tokenHash: createHash("sha256").update(invitation.token).digest("hex"),
    status: invitation.status,
    invitedById: DEMO_INVITER.id,
    invitedByName: DEMO_INVITER.name,
    invitedByEmail: DEMO_INVITER.email,
    expiresAt: at(base, invitation.expiresInDays, 9, 0),
    lastSentAt: at(base, -invitation.sentDaysAgo, 9, 0),
    sentCount: invitation.sentCount,
    acceptedAt: invitation.acceptedDaysAgo === undefined ? null : at(base, -invitation.acceptedDaysAgo, 10, 30),
    acceptedById: invitation.acceptedBy?.id ?? null,
    acceptedByName: invitation.acceptedBy?.name ?? null,
    createdAt: at(base, -invitation.createdDaysAgo, 9, 0),
  }));

  // ── Plantillas de WhatsApp (issue #35): misma data canónica del dataset, con
  // la empresa demo y la autora real del panel. ──
  const messageTemplatesData: Prisma.MessageTemplateUncheckedCreateInput[] = DEMO_MESSAGE_TEMPLATES.map((template) => ({
    ...template,
    ...org,
    active: true,
    createdById: DEMO_INVITER.id,
    createdByName: DEMO_INVITER.name,
    updatedById: DEMO_INVITER.id,
    updatedByName: DEMO_INVITER.name,
    createdAt: at(base, -8, 10, 15),
  }));

  // ── Identidad de la demo (issue #32): logos de la empresa y avatares del
  // equipo, para que el shell y la sección Empresa no caigan al monograma. Las
  // imágenes ya se generaron arriba (también las usan los clientes y promotoras).
  const logosData: Prisma.OrganizationLogoUncheckedCreateInput[] = [
    { id: "demo_logo_light", organizationId, variant: "light", mime: images.logoLight.mime, size: images.logoLight.size, width: images.logoLight.width, height: images.logoLight.height, data: images.logoLight.data, createdAt: at(base, -30, 10, 0) },
    { id: "demo_logo_dark", organizationId, variant: "dark", mime: images.logoDark.mime, size: images.logoDark.size, width: images.logoDark.width, height: images.logoDark.height, data: images.logoDark.data, createdAt: at(base, -30, 10, 0) },
  ];

  // ── Inventario y asignaciones (una con salida y devolución con daño) ──
  const inventoryData: Prisma.InventoryItemUncheckedCreateInput[] = INVENTORY.map((item) => ({
    ...item,
    ...org,
    createdAt: at(base, -150, 9, 0),
  }));
  const assignmentsData: Prisma.EventInventoryUncheckedCreateInput[] = [
    { id: "demo_asg_activacion_p5", eventId: inProgress.id, inventoryId: "demo_inv_led_p5", quantity: 12, startsAt: inProgress.setupAt, endsAt: atDay(inProgress.strikeAt, 0, 12), checkedOut: true, checkedIn: false, checkedOutAt: atDay(inProgress.setupAt, 0, 8, 20), conditionOut: "Bueno" },
    { id: "demo_asg_proximo_p3", eventId: next.id, inventoryId: "demo_inv_led_p3", quantity: 20, startsAt: next.setupAt, endsAt: atDay(next.strikeAt, 0, 14), checkedOut: false, checkedIn: false },
    { id: "demo_asg_proximo_truss", eventId: next.id, inventoryId: "demo_inv_truss", quantity: 12, startsAt: next.setupAt, endsAt: atDay(next.strikeAt, 0, 14), checkedOut: false, checkedIn: false },
    { id: "demo_asg_feria_totem", eventId: recentPast.id, inventoryId: "demo_inv_totem", quantity: 3, startsAt: recentPast.setupAt, endsAt: recentPast.strikeAt, checkedOut: true, checkedIn: true, checkedOutAt: atDay(recentPast.setupAt, 0, 8, 10), checkedInAt: atDay(recentPast.strikeAt, 0, 11, 20), conditionOut: "Bueno", conditionIn: "Con daño: marco doblado", damagedQuantity: 1, missingQuantity: 0, damageNotes: "Un tótem volvió con el marco doblado; queda en mantenimiento y se descuenta del saldo." },
    { id: "demo_asg_feria_paneles", eventId: longestPast.id, inventoryId: "demo_inv_panels", quantity: 8, startsAt: longestPast.setupAt, endsAt: longestPast.strikeAt, checkedOut: true, checkedIn: true, checkedOutAt: atDay(longestPast.setupAt, 0, 8, 15), checkedInAt: atDay(longestPast.strikeAt, 0, 10, 30), conditionOut: "Bueno", conditionIn: "Con faltante: 2 unidades", damagedQuantity: 0, missingQuantity: 2, damageNotes: "Dos bastidores no volvieron del predio; el cliente tiene el reclamo abierto." },
    { id: "demo_asg_showroom_touch", eventId: pastFiller.id, inventoryId: "demo_inv_totem_touch", quantity: 2, startsAt: pastFiller.setupAt, endsAt: pastFiller.strikeAt, checkedOut: true, checkedIn: true, checkedOutAt: atDay(pastFiller.setupAt, 0, 7, 20), checkedInAt: atDay(pastFiller.strikeAt, 0, 10, 0), conditionOut: "Bueno", conditionIn: "Bueno" },
  ];

  // ── Leads del sitio (con un pedido de cotización) ──
  const leadsData: Prisma.LeadUncheckedCreateInput[] = LEADS.map((lead) => ({
    id: lead.id,
    ...org,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    company: lead.company,
    ruc: null,
    reason: lead.reason,
    message: lead.message,
    location: lead.location,
    status: lead.status,
    source: "website",
    consentAt: at(base, -lead.createdDaysAgo, 9, 0),
    createdAt: at(base, -lead.createdDaysAgo, 9, 0),
    eventDate: at(base, lead.eventDateDays, 12, 0),
    internalNotes: lead.internalNotes,
  }));
  const quoteData: Prisma.QuoteRequestUncheckedCreateInput = {
    id: "demo_quote_cerveza",
    ...org,
    leadId: "demo_lead_cerveza",
    referenceTotal: 15_000_000,
    currency: "PYG",
    durationDays: 1,
    eventDate: at(base, 40, 12, 0),
    location: "Asunción",
    source: "website",
    createdAt: at(base, -1, 9, 12),
  };
  const quoteItemsData: Prisma.QuoteItemUncheckedCreateInput[] = [
    { id: "demo_quote_item_1", quoteRequestId: "demo_quote_cerveza", productSlug: "pantalla-led-p3-500", productName: "Pantalla LED P3.9 500x500", quantity: 12, duration: 1, billingUnit: "DAILY", unitPrice: 950_000, subtotal: 11_400_000 },
    { id: "demo_quote_item_2", quoteRequestId: "demo_quote_cerveza", productSlug: "totem-led-2x1", productName: "Tótem LED 2x1 m", quantity: 2, duration: 1, billingUnit: "DAILY", unitPrice: 1_800_000, subtotal: 3_600_000 },
  ];

  const auditData = buildAuditTrail(organizationId, base, {
    next,
    second,
    third,
    longestPast,
    recentPast,
    inProgress,
    draft,
  });

  await db.$transaction(
    async (tx) => {
      // Un solo provisor a la vez (dos visitantes simultáneos no se pisan).
      await tx.$queryRawUnsafe("select pg_advisory_xact_lock(724150114)::text as locked");
      await wipeDemoData(tx, organizationId);
      // Equipo simulado de la demo (los actores de la auditoría): miembros solo
      // de esta empresa, con su avatar. Se borran en cada wipe y se recrean acá.
      const collaboratorsHash = await hashPassword(randomBytes(24).toString("base64url"));
      for (const collaborator of COLLABORATORS) {
        await tx.adminUser.create({
          data: {
            id: collaborator.id,
            name: collaborator.name,
            email: collaborator.email,
            passwordHash: collaboratorsHash,
            role: collaborator.role,
            active: true,
            autoLockEnabled: false,
          },
        });
        await tx.adminMembership.create({
          data: {
            id: `demo_membership_${collaborator.id}`,
            adminUserId: collaborator.id,
            organizationId,
            role: collaborator.role,
            active: true,
          },
        });
        const avatar = images.collaborators.get(collaborator.id);
        if (avatar) {
          await tx.adminUserAvatar.create({
            data: { id: `demo_avatar_${collaborator.id}`, userId: collaborator.id, mime: avatar.mime, size: avatar.size, width: avatar.width, height: avatar.height, data: avatar.data },
          });
        }
      }
      await tx.adminUserAvatar.upsert({
        where: { userId: DEMO_USER_ID },
        create: { id: "demo_avatar_visitor", userId: DEMO_USER_ID, mime: images.demoAvatar.mime, size: images.demoAvatar.size, width: images.demoAvatar.width, height: images.demoAvatar.height, data: images.demoAvatar.data },
        update: { mime: images.demoAvatar.mime, size: images.demoAvatar.size, width: images.demoAvatar.width, height: images.demoAvatar.height, data: images.demoAvatar.data },
      });
      await tx.client.createMany({ data: clientsData });
      await tx.clientLogo.createMany({ data: clientLogosData });
      await tx.event.createMany({ data: eventsData });
      await tx.promoter.createMany({ data: promotersData });
      await tx.eventTask.createMany({ data: tasksData });
      await tx.supplier.createMany({ data: suppliersData });
      await tx.supplierJob.createMany({ data: jobsData });
      await tx.budget.createMany({ data: budgetsData });
      await tx.budgetItem.createMany({ data: budgetItemsData });
      // Las cuentas van antes que los cobros y los gastos: todos las referencian.
      await tx.treasuryAccount.createMany({
        data: TREASURY_ACCOUNTS.map((account) => ({ ...account, organizationId, currency: "PYG", active: true, createdAt: at(base, -40, 9, 0) })),
      });
      await tx.clientPayment.createMany({ data: paymentsData });
      await tx.treasuryMovement.createMany({ data: treasuryMovementsData });
      await tx.expense.createMany({ data: expensesData });
      await tx.budgetPaymentProof.createMany({ data: proofsData });
      await tx.expectedPayment.createMany({ data: expectedPaymentsData });
      await tx.teamInvitation.createMany({ data: invitationsData });
      await tx.mailLog.createMany({ data: mailLogsData });
      await tx.messageTemplate.createMany({ data: messageTemplatesData });
      await tx.paymentReminderLog.createMany({ data: reminderLogsData });
      await tx.organizationLogo.createMany({ data: logosData });
      await tx.inventoryItem.createMany({ data: inventoryData });
      await tx.eventInventory.createMany({ data: assignmentsData });
      await tx.budgetChangeRequest.createMany({ data: changeRequestsData });
      await tx.lead.createMany({ data: leadsData });
      await tx.quoteRequest.create({ data: quoteData });
      await tx.quoteItem.createMany({ data: quoteItemsData });
      await tx.auditLog.createMany({ data: auditData });
    },
    { timeout: 30_000 },
  );
}

/**
 * Borra los datos operativos de la organización demo (en orden de FKs) para que
 * el dataset salga canónico. La organización y el usuario demo no se tocan; las
 * sesiones demo se limpian aparte.
 */
async function wipeDemoData(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.paymentReminderLog.deleteMany({ where: { organizationId } });
  await tx.budgetPaymentProof.deleteMany({ where: { organizationId } });
  await tx.expectedPayment.deleteMany({ where: { organizationId } });
  await tx.eventInventory.deleteMany({ where: { event: { organizationId } } });
  await tx.eventTask.deleteMany({ where: { event: { organizationId } } });
  await tx.clientPayment.deleteMany({ where: { organizationId } });
  await tx.budgetChangeRequest.deleteMany({ where: { organizationId } });
  await tx.budgetItem.deleteMany({ where: { budget: { organizationId } } });
  await tx.budget.deleteMany({ where: { organizationId } });
  await tx.quoteItem.deleteMany({ where: { quoteRequest: { organizationId } } });
  await tx.quoteRequest.deleteMany({ where: { organizationId } });
  await tx.lead.deleteMany({ where: { organizationId } });
  await tx.expense.deleteMany({ where: { organizationId } });
  await tx.treasuryMovement.deleteMany({ where: { organizationId } });
  await tx.supplierJob.deleteMany({ where: { organizationId } });
  await tx.event.deleteMany({ where: { organizationId } });
  await tx.supplier.deleteMany({ where: { organizationId } });
  await tx.clientLogo.deleteMany({ where: { client: { organizationId } } });
  await tx.client.deleteMany({ where: { organizationId } });
  await tx.inventoryItem.deleteMany({ where: { organizationId } });
  await tx.promoter.deleteMany({ where: { organizationId } });
  await tx.treasuryAccount.deleteMany({ where: { organizationId } });
  await tx.teamInvitation.deleteMany({ where: { organizationId } });
  await tx.mailLog.deleteMany({ where: { organizationId } });
  await tx.messageTemplate.deleteMany({ where: { organizationId } });
  await tx.organizationLogo.deleteMany({ where: { organizationId } });
  // Equipo simulado: la membresía primero y la cuenta después (no pertenecen a
  // ninguna otra empresa, así que borrarlas no toca datos reales). La membresía
  // del usuario demo no se toca: es la que habilita su sesión de solo lectura.
  await tx.adminMembership.deleteMany({ where: { organizationId, adminUserId: { not: DEMO_USER_ID } } });
  for (const collaborator of COLLABORATORS) {
    await tx.adminUser.deleteMany({ where: { id: collaborator.id } });
  }
  await tx.auditLog.deleteMany({ where: { organizationId } });
}

// ── Auditoría ───────────────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  actor: DemoAuditActor;
  action: "create" | "update" | "delete" | "status" | "checkout" | "checkin" | "convert" | "remind" | "send";
  entity: string;
  entityId: string;
  summary: string;
  days: number;
  hour: number;
  minute: number;
  detail?: Prisma.InputJsonValue;
};

type AuditContext = {
  next: BuiltEvent;
  second: BuiltEvent;
  third: BuiltEvent;
  longestPast: BuiltEvent;
  recentPast: BuiltEvent;
  inProgress: BuiltEvent;
  draft: BuiltEvent;
};

/** Filas de auditoría coherentes con el dataset (mismos actores y entidades). */
function buildAuditTrail(organizationId: string, base: Date, context: AuditContext): Prisma.AuditLogUncheckedCreateInput[] {
  const { sales, ops } = ACTORS;
  const nextClient = CLIENT_BY_ID.get(context.next.clientId);
  const closedClient = CLIENT_BY_ID.get(context.longestPast.clientId);
  const moraClient = CLIENT_BY_ID.get(context.recentPast.clientId);
  const nextContact = clientContact(context.next.clientId);
  const thirdContact = clientContact(context.third.clientId);
  const pendingBudgetTitle = `Alquiler de pantallas ${context.second.name}`;
  const moraBudgetTitle = `Alquiler de pantallas ${context.recentPast.name}`;
  const rows: AuditRow[] = [
    // Dinero y equipo (issues #27, #28, #30 y #31): cuentas de tesorería,
    // movimientos, gastos, pagos esperados, correos e invitaciones.
    {
      id: "demo_audit_treasury_cash",
      actor: sales,
      action: "create",
      entity: "TreasuryAccount",
      entityId: "demo_treasury_cash",
      summary: "Creó la cuenta de tesorería «Efectivo»",
      days: -40,
      hour: 9,
      minute: 35,
      detail: { fields: { name: "Efectivo", type: "CASH", currency: "PYG", openingBalance: 1_500_000 } },
    },
    {
      id: "demo_audit_treasury_ueno",
      actor: sales,
      action: "create",
      entity: "TreasuryAccount",
      entityId: "demo_treasury_ueno",
      summary: "Creó la cuenta de tesorería «Ueno Bank»",
      days: -40,
      hour: 9,
      minute: 40,
      detail: { fields: { name: "Ueno Bank", type: "BANK", bank: "Ueno Bank", openingBalance: 5_000_000 } },
    },
    {
      id: "demo_audit_treasury_cheques",
      actor: sales,
      action: "create",
      entity: "TreasuryAccount",
      entityId: "demo_treasury_cheques",
      summary: "Creó la cuenta de tesorería «Cheques a cobrar»",
      days: -40,
      hour: 9,
      minute: 42,
      detail: { fields: { name: "Cheques a cobrar", type: "CHEQUE", openingBalance: 0 } },
    },
    {
      id: "demo_audit_treasury_transfer",
      actor: sales,
      action: "create",
      entity: "TreasuryMovement",
      entityId: "demo_tm_transfer_cheque",
      summary: "Registró la transferencia de tesorería «Cheques a cobrar» → «Efectivo»",
      days: -4,
      hour: 11,
      minute: 15,
      detail: { fields: { direction: "TRANSFER", amount: 2_000_000, notes: "Cheque cobrado en efectivo: se acredita en caja." } },
    },
    {
      id: "demo_audit_job_pago_grafica",
      actor: sales,
      action: "create",
      entity: "TreasuryMovement",
      entityId: "demo_tm_demo_job_grafica",
      summary: "Pagó 1.200.000 Gs. al proveedor «Gráfica La Colmena» desde «Ueno Bank»",
      days: -5,
      hour: 15,
      minute: 20,
      detail: { fields: { direction: "OUT", amount: 1_200_000, origin: "supplier_job", jobId: "demo_job_grafica" } },
    },
    {
      id: "demo_audit_expense_generador",
      actor: ops,
      action: "create",
      entity: "Expense",
      entityId: "demo_expense_generador",
      summary: "Cargó el gasto «Alquiler de generador para el montaje» desde «Ueno Bank»",
      days: -2,
      hour: 9,
      minute: 10,
      detail: { fields: { amount: 1_500_000, category: "RENT", accountId: "demo_treasury_ueno", eventId: context.inProgress.id } },
    },
    {
      id: "demo_audit_expense_cables",
      actor: ops,
      action: "create",
      entity: "Expense",
      entityId: "demo_expense_cables",
      summary: "Cargó el gasto «Cables, fichas y conectores» desde «Efectivo»",
      days: -2,
      hour: 17,
      minute: 5,
      detail: { fields: { amount: 780_000, category: "MATERIALS", accountId: "demo_treasury_cash", eventId: null } },
    },
    {
      id: "demo_audit_expense_asignado",
      actor: ops,
      action: "update",
      entity: "Expense",
      entityId: "demo_expense_combustible",
      summary: "Editó el gasto «Combustible y peajes del traslado»",
      days: -1,
      hour: 12,
      minute: 40,
      detail: { changes: { eventId: { from: null, to: context.next.id } }, fields: { event: context.next.name } },
    },
    {
      id: "demo_audit_expected_confirm",
      actor: sales,
      action: "status",
      entity: "ExpectedPayment",
      entityId: "demo_expected_aprobado_advance",
      summary: `Confirmó el pago esperado «Anticipo» de «${nextClient?.company ?? ""}» en «Ueno Bank»`,
      days: -5,
      hour: 15,
      minute: 32,
      detail: { changes: { status: { from: "AWAITING", to: "CONFIRMED" } }, fields: { amount: 9_234_000, account: "Ueno Bank", paymentId: "demo_pay_aprobado" } },
    },
    {
      id: "demo_audit_mail_budget",
      actor: sales,
      action: "send",
      entity: "Budget",
      entityId: "demo_budget_pendiente",
      summary: `Envió por correo el presupuesto «${pendingBudgetTitle}» a «${CLIENT_BY_ID.get(context.second.clientId)?.company ?? ""}» (${clientContact(context.second.clientId).email})`,
      days: -6,
      hour: 9,
      minute: 22,
      detail: { fields: { category: "budget", status: "sent", portalCode: "D3M9-F3R4-A2PY-Q7SC-K4VT" } },
    },
    {
      id: "demo_audit_reminder_mora",
      actor: sales,
      action: "remind",
      entity: "ExpectedPayment",
      entityId: "demo_expected_mora_cuota_1",
      summary: `Envió el recordatorio de pago por email a «${moraClient?.company ?? ""}» (Cuota 1 · saldo del presupuesto «${moraBudgetTitle}»)`,
      days: -2,
      hour: 8,
      minute: 5,
      detail: { fields: { channel: "email", status: "sent", amount: 4_000_000, to: clientContact(context.recentPast.clientId).email } },
    },
    {
      id: "demo_audit_invitation_sent",
      actor: sales,
      action: "create",
      entity: "TeamInvitation",
      entityId: "demo_invitation_pending",
      summary: "Invitó a «rocio.benitez@ledbox.demo» a sumarse al equipo como Finance",
      days: -1,
      hour: 11,
      minute: 15,
      detail: { fields: { email: "rocio.benitez@ledbox.demo", role: "FINANCE", status: "sent" } },
    },
    {
      id: "demo_audit_invitation_accepted",
      actor: ops,
      action: "status",
      entity: "TeamInvitation",
      entityId: "demo_invitation_accepted",
      summary: "Aceptó la invitación y se sumó a «LedBox Demo» como Operations",
      days: -21,
      hour: 10,
      minute: 30,
      detail: { fields: { email: "marco.ferreira@ledbox.demo", role: "OPERATIONS", via: "password" } },
    },
    // Casos difíciles (issue #24): disponibilidad, cheque rechazado, faltante y
    // atraso de proveedor, con el mismo formato de historial que las mutaciones
    // reales del panel (antes/después).
    {
      id: "demo_audit_promoter_lorena",
      actor: ops,
      action: "status",
      entity: "Promoter",
      entityId: "demo_promoter_lorena",
      summary: "Actualizó la disponibilidad de «Lorena Ríos»",
      days: -2,
      hour: 9,
      minute: 40,
      detail: { changes: { availability: { from: "AVAILABLE", to: "UNAVAILABLE" }, availabilityNote: { from: null, to: "De viaje por trabajo; retoma a fin de mes." } } },
    },
    {
      id: "demo_audit_pago_rechazado",
      actor: sales,
      action: "status",
      entity: "ClientPayment",
      entityId: "demo_pay_mora_cheque",
      summary: `Anuló el cobro a plazo de «${moraClient?.company ?? ""}» por cheque rechazado`,
      days: -13,
      hour: 10,
      minute: 5,
      detail: { changes: { status: { from: "PENDING", to: "CANCELLED" } }, fields: { reference: "CHQ-5502", method: "Cheque" } },
    },
    {
      id: "demo_audit_checkin_paneles",
      actor: ops,
      action: "status",
      entity: "EventInventory",
      entityId: "demo_asg_feria_paneles",
      summary: `Actualizó el movimiento de «Bastidor de piso para pantalla» en «${context.longestPast.name}» (2 faltantes)`,
      days: -15,
      hour: 10,
      minute: 35,
      detail: { changes: { missingQuantity: { from: 0, to: 2 }, conditionIn: { from: "Bueno", to: "Con faltante: 2 unidades" } } },
    },
    {
      id: "demo_audit_job_atraso",
      actor: ops,
      action: "status",
      entity: "SupplierJob",
      entityId: "demo_job_atraso",
      summary: `Cambió el estado del trabajo «Escenografía y mobiliario · ${context.next.name}»`,
      days: -1,
      hour: 17,
      minute: 10,
      detail: { changes: { status: { from: "CONTRACTED", to: "IN_PRODUCTION" } }, fields: { atraso: "El taller prometió entregar hace dos días." } },
    },
    {
      id: "demo_audit_client_tigo",
      actor: sales,
      action: "create",
      entity: "Client",
      entityId: "demo_client_tigo",
      summary: "Creó el cliente «Tigo Paraguay»",
      days: -26,
      hour: 9,
      minute: 10,
      detail: { fields: { name: "Lucía Fernández", company: "Tigo Paraguay", type: "FINAL", phone: "+595 981 214 500" } },
    },
    {
      id: "demo_audit_client_samsung",
      actor: sales,
      action: "create",
      entity: "Client",
      entityId: "demo_client_samsung",
      summary: "Creó el cliente «Samsung Paraguay»",
      days: -24,
      hour: 15,
      minute: 40,
      detail: { fields: { name: "Rodrigo Núñez", company: "Samsung Paraguay", type: "FINAL" } },
    },
    {
      id: "demo_audit_event_expo",
      actor: ops,
      action: "create",
      entity: "Event",
      entityId: context.longestPast.id,
      summary: `Creó el evento «${context.longestPast.name}» del cliente «${closedClient?.company ?? ""}»`,
      days: -22,
      hour: 11,
      minute: 5,
      detail: { fields: { name: context.longestPast.name, location: context.longestPast.location, status: context.longestPast.status } },
    },
    {
      id: "demo_audit_budget_cobrado",
      actor: sales,
      action: "create",
      entity: "Budget",
      entityId: "demo_budget_cobrado",
      summary: `Creó el presupuesto «Cierre de feria ${context.longestPast.name}»`,
      days: -20,
      hour: 9,
      minute: 25,
      detail: { fields: { title: `Cierre de feria ${context.longestPast.name}`, status: "DRAFT", items: 3 } },
    },
    {
      id: "demo_audit_job_flete",
      actor: ops,
      action: "create",
      entity: "SupplierJob",
      entityId: "demo_job_flete_feria",
      summary: `Cargó el trabajo «Flete, montaje y desmontaje · ${context.longestPast.name}»`,
      days: -18,
      hour: 10,
      minute: 20,
      detail: { fields: { supplier: "Transportes Ríos", total: 1_800_000, advance: 1_800_000, status: "CONTRACTED" } },
    },
    {
      id: "demo_audit_asg_totem",
      actor: ops,
      action: "create",
      entity: "EventInventory",
      entityId: "demo_asg_feria_totem",
      summary: `Asignó «Tótem LED 2x1 m» a «${context.recentPast.name}» (3 unidades)`,
      days: -16,
      hour: 16,
      minute: 40,
      detail: { fields: { quantity: 3, inventoryId: "demo_inv_totem" } },
    },
    {
      id: "demo_audit_checkin_totem",
      actor: ops,
      action: "status",
      entity: "EventInventory",
      entityId: "demo_asg_feria_totem",
      summary: `Actualizó el movimiento de «Tótem LED 2x1 m» en «${context.recentPast.name}»`,
      days: -15,
      hour: 11,
      minute: 25,
      detail: { changes: { conditionIn: { from: null, to: "Con daño: marco doblado" } } },
    },
    {
      id: "demo_audit_pay_cobrado",
      actor: sales,
      action: "create",
      entity: "ClientPayment",
      entityId: "demo_pay_cobrado_1",
      summary: `Registró un cobro del cliente «${closedClient?.company ?? ""}»`,
      days: -12,
      hour: 9,
      minute: 45,
      detail: { fields: { method: "Transferencia", reference: "TRF-87990" } },
    },
    {
      id: "demo_audit_budget_aprobado",
      actor: sales,
      action: "create",
      entity: "Budget",
      entityId: "demo_budget_aprobado",
      summary: `Creó el presupuesto «Producción integral ${context.next.name}» del cliente «${nextClient?.company ?? ""}»`,
      days: -10,
      hour: 11,
      minute: 5,
      detail: { fields: { title: `Producción integral ${context.next.name}`, status: "DRAFT", items: 4 } },
    },
    {
      id: "demo_audit_lead_vision",
      actor: sales,
      action: "status",
      entity: "Lead",
      entityId: "demo_lead_vision",
      summary: "Cambió el estado del lead «Carla Núñez»",
      days: -7,
      hour: 12,
      minute: 25,
      detail: { changes: { status: { from: "NEW", to: "CONTACTED" } } },
    },
    {
      id: "demo_audit_approve_lanzamiento",
      actor: nextContact,
      action: "status",
      entity: "Budget",
      entityId: "demo_budget_aprobado",
      summary: `El cliente «${nextContact.name}» aprobó el presupuesto «Producción integral ${context.next.name}» desde el portal`,
      days: -5,
      hour: 16,
      minute: 31,
      detail: { fields: { approvalMethod: "digital" } },
    },
    {
      id: "demo_audit_pay_aprobado",
      actor: sales,
      action: "create",
      entity: "ClientPayment",
      entityId: "demo_pay_aprobado",
      summary: `Registró un cobro del cliente «${nextClient?.company ?? ""}»`,
      days: -4,
      hour: 15,
      minute: 35,
      detail: { fields: { method: "Transferencia", reference: "TRF-88213" } },
    },
    {
      id: "demo_audit_job_balance",
      actor: ops,
      action: "status",
      entity: "SupplierJob",
      entityId: "demo_job_balance",
      summary: `Cambió el estado del trabajo «Refuerzo de sonido · ${context.recentPast.name}»`,
      days: -3,
      hour: 8,
      minute: 50,
      detail: { changes: { status: { from: "DELIVERED", to: "BALANCE_PENDING" } } },
    },
    {
      id: "demo_audit_budget_pendiente",
      actor: sales,
      action: "create",
      entity: "Budget",
      entityId: "demo_budget_pendiente",
      summary: `Creó el presupuesto «Alquiler de pantallas ${context.second.name}»`,
      days: -2,
      hour: 9,
      minute: 20,
      detail: { fields: { title: `Alquiler de pantallas ${context.second.name}`, status: "DRAFT", items: 3 } },
    },
    {
      id: "demo_audit_payment_details",
      actor: sales,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: "Actualizó los datos de pago de «LedBox Demo» para el portal y la hoja impresa",
      days: -16,
      hour: 12,
      minute: 15,
      detail: { fields: { bank: "Ueno Bank", account: "6191649354", alias: "c.i +595 982 029217" } },
    },
    {
      id: "demo_audit_plan_pagos",
      actor: sales,
      action: "update",
      entity: "Budget",
      entityId: "demo_budget_aprobado",
      summary: `Definió el plan de pagos del presupuesto «Producción integral ${context.next.name}» del cliente «${nextClient?.company ?? ""}»`,
      days: -9,
      hour: 9,
      minute: 50,
      detail: { changes: { advanceAmount: { from: 0, to: 9_234_000 }, installments: { from: 0, to: 2 } } },
    },
    {
      id: "demo_audit_rebaja_aceptada",
      actor: sales,
      action: "update",
      entity: "Budget",
      entityId: "demo_budget_aprobado",
      summary: `Aceptó el pedido de rebaja de «${nextClient?.company ?? ""}» para el presupuesto «Producción integral ${context.next.name}» (descuento de Gs. 1.620.000)`,
      days: -8,
      hour: 10,
      minute: 5,
      detail: { changes: { discount: { from: 0, to: 1_620_000 } } },
    },
    {
      id: "demo_audit_rebaja_rechazada",
      actor: sales,
      action: "status",
      entity: "Budget",
      entityId: "demo_budget_aprobado",
      summary: `Rechazó el pedido de rebaja de «${nextClient?.company ?? ""}» para el presupuesto «Producción integral ${context.next.name}»: el margen del evento está ajustado`,
      days: -5,
      hour: 16,
      minute: 20,
      detail: { fields: { rechazo: "No llegamos a ese descuento; sumamos un tótem sin cargo." } },
    },
    {
      id: "demo_audit_propuesta_pendiente",
      actor: clientContact(context.second.clientId),
      action: "create",
      entity: "Budget",
      entityId: "demo_budget_pendiente",
      summary: `El cliente «${clientContact(context.second.clientId).name}» propuso nuevos ítems para el presupuesto «Alquiler de pantallas ${context.second.name}» desde el portal`,
      days: -1,
      hour: 10,
      minute: 15,
      detail: { fields: { items: 3, propuesta: "ítems" } },
    },
    {
      id: "demo_audit_revision_tercero",
      actor: thirdContact,
      action: "status",
      entity: "Budget",
      entityId: "demo_budget_cambios",
      summary: `El cliente «${thirdContact.name}» pidió cambios en el presupuesto «Stands y pantallas ${context.third.name}» desde el portal`,
      days: -1,
      hour: 11,
      minute: 22,
      detail: { fields: { revisionRequestedAt: true } },
    },
  ];

  return rows.map((row) => ({
    id: row.id,
    organizationId,
    actorId: row.actor.id,
    actorName: row.actor.name,
    actorEmail: row.actor.email,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    summary: row.summary,
    detail: row.detail,
    createdAt: at(base, row.days, row.hour, row.minute),
  }));
}
