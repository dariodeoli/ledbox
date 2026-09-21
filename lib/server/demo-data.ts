import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { hashPassword } from "./auth";
import { DAY_MS, dayKeyOf, dayStart } from "./notifications";

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
 */

export const DEMO_ORGANIZATION_ID = "org_demo";
export const DEMO_ORGANIZATION_SLUG = "demo";
export const DEMO_ORGANIZATION_NAME = "LedBox Demo";

export const DEMO_USER_ID = "demo_visitor";
export const DEMO_USER_EMAIL = "demo@ledbox.online";
export const DEMO_USER_NAME = "Visitante demo";

export const DEMO_MEMBERSHIP_ID = "demo_visitor_membership";

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

const DEMO_ORGANIZATION: Prisma.OrganizationUncheckedCreateInput = {
  id: DEMO_ORGANIZATION_ID,
  name: DEMO_ORGANIZATION_NAME,
  slug: DEMO_ORGANIZATION_SLUG,
  active: true,
};

type DemoEventStatus = "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED";

/** Estado por fecha: pasado finalizado, hoy en curso, futuro confirmado (el borrador se declara). */
function eventStatusFrom(startsAt: Date, endsAt: Date, now: Date, draft = false): DemoEventStatus {
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

/** Contacto del cliente de un evento (para las aprobaciones del portal). */
function clientContact(clientId: string): DemoAuditActor {
  const client = CLIENT_BY_ID.get(clientId);
  return { id: "portal", name: client?.name ?? "Cliente (portal)", email: client?.email ?? "" };
}

// ── Eventos reales de Paraguay (mes/día reales; el año se proyecta a la ventana) ──
//
// Fechas confirmadas con fuentes públicas (jul-sep 2026): Expo Paraguay ARP
// (11–26 jul), Expo eCommerce CAPACE (21 may), eCommerce Day (24 sep),
// Expo Paraguay Brasil (11–13 nov), ExpoNegocios (30 sep–1 oct), Expo Real
// Estate (23–24 jun), CADAM Motor Show (30 jul–9 ago), Cyberday CAPACE (2–4
// nov), Hot Sale CAPACE (6–8 abr), Asunción Fashion Week Invierno (27–30 abr) y
// Resort (7–11 oct) y Asunciónico (17–19 mar). Expo Itapúa y Expo Hogar no
// publicaron fecha 2026: se ubican en su mes habitual (ago y sep) de forma
// plausible.

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
  { id: "demo_event_asuncionico", clientId: "demo_client_cocacola", name: "Asunciónico", location: "Jockey Club Paraguayo, Asunción", month: 3, day: 17, days: 3, startsHour: 16, notes: "Festival de música: escenario principal, pantallas laterales y activación de marca." },
  { id: "demo_event_hot_sale", clientId: "demo_client_cellshop", name: "Hot Sale Paraguay · showroom", location: "Paseo La Galería, Asunción", month: 4, day: 6, days: 3, notes: "Showroom de la campaña de CAPACE: pantalla de ofertas y transmisión en vivo." },
  { id: "demo_event_afw_invierno", clientId: "demo_client_shopping", name: "Asunción Fashion Week · Invierno", location: "Distrito Perseverancia, Asunción", month: 4, day: 27, days: 4, startsHour: 20, notes: "Pasarela y showroom: pantalla de fondo, iluminación y contenido para redes." },
  { id: "demo_event_expo_ecommerce", clientId: "demo_client_samsung", name: "Expo eCommerce Paraguay", location: "Centro de Convenciones Paseo La Galería, Asunción", month: 5, day: 21, days: 1, notes: "Congreso de comercio electrónico de CAPACE; stand con demo de producto." },
  { id: "demo_event_real_estate", clientId: "demo_client_ueno", name: "Expo Real Estate Paraguay", location: "Centro de Convenciones de la Conmebol, Asunción", month: 6, day: 23, days: 2, notes: "Feria inmobiliaria: pantallas de sala, lanzamientos y tótems de consulta." },
  { id: "demo_event_expo_paraguay", clientId: "demo_client_tigo", name: "Expo Paraguay · ARP", location: "Predio Ferial ARP, Mariano Roque Alonso", month: 7, day: 11, days: 16, notes: "La muestra más grande del país: pabellón de marca, escenario y 16 días de operación." },
  { id: "demo_event_cadam", clientId: "demo_client_itau", name: "CADAM Motor Show", location: "Paseo La Galería (Nivel -3), Asunción", month: 7, day: 30, days: 11, notes: "Salón del automóvil: pantallas por marca, simuladores y financiación." },
  { id: "demo_event_expo_itapua", clientId: "demo_client_trebol", name: "Expo Itapúa", location: "Costanera de Encarnación", month: 8, day: 6, days: 4, notes: "Feria regional del sur: stand institucional, degustación y escenario." },
  { id: "demo_event_expo_hogar", clientId: "demo_client_vision", name: "Expo Hogar", location: "Centro de Convenciones, Asunción", month: 9, day: 3, days: 4, notes: "Feria de vivienda y hogar: simulador de créditos y ambientación de stands." },
  { id: "demo_event_ecommerce_day", clientId: "demo_client_lg", name: "eCommerce Day Paraguay", location: "Centro de Convenciones Paseo La Galería, Asunción", month: 9, day: 24, days: 1, notes: "Jornada de ecommerce con demo de producto y contenido en vivo." },
  { id: "demo_event_exponegocios", clientId: "demo_client_personal", name: "ExpoNegocios", location: "Centro de Eventos Paseo La Galería, Asunción", month: 9, day: 30, days: 2, notes: "Encuentro empresarial: pantalla principal, streaming y networking." },
  { id: "demo_event_afw_resort", clientId: "demo_client_paseo", name: "Asunción Fashion Week · Resort", location: "Distrito Perseverancia, Asunción", month: 10, day: 7, days: 5, startsHour: 20, notes: "Edición Resort: pasarela, contenido vertical y showroom." },
  { id: "demo_event_cyberday", clientId: "demo_client_nissei", name: "Cyberday Paraguay", location: "Paseo La Galería, Asunción", month: 11, day: 2, days: 3, notes: "Campaña de compras online de CAPACE con estudio de transmisión." },
  { id: "demo_event_expo_brasil", clientId: "demo_client_claro", name: "Expo Paraguay Brasil", location: "Centro TASK · PTI, Hernandarias", month: 11, day: 11, days: 3, notes: "Rueda de negocios y feria binacional en Alto Paraná." },
];

const REAL_EVENTS_COUNT = REAL_EVENTS.length;

/**
 * Eventos relativos a HOY: activaciones de marca (no tienen fecha publicada) y
 * el borrador. Garantizan que la demo siempre tenga algo en curso y algo
 * pendiente de confirmar, más allá de las fechas reales de las ferias.
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
  notes: string;
};

const RELATIVE_EVENTS: readonly DemoRelativeEvent[] = [
  { id: "demo_event_activacion_mall", clientId: "demo_client_samsung", name: "Activación Samsung · Shopping del Sol", location: "Shopping del Sol, Asunción", offsetDays: -1, days: 3, startsHour: 10, notes: "Activación en el atrio: pantalla LED, tótems interactivos y demo de producto." },
  { id: "demo_event_activacion_tigo", clientId: "demo_client_tigo", name: "Activación Tigo · Paseo La Galería", location: "Paseo La Galería, Asunción", offsetDays: 4, days: 2, startsHour: 16, notes: "Lanzamiento de planes en el atrio central, con pantalla y sonido." },
  { id: "demo_event_activacion_verano", clientId: "demo_client_cerveza", name: "Activación Cervecería Paraguaya · Costanera", location: "Costanera de Asunción", offsetDays: 45, days: 3, startsHour: 18, draft: true, notes: "Borrador: falta la habilitación municipal y cerrar la estructura del escenario." },
];

const RELATIVE_EVENTS_COUNT = RELATIVE_EVENTS.length;

/**
 * Mínimos del dataset simulado. El ancla del día se valida contra estos conteos
 * (y contra la agenda futura) para que una provisión interrumpida, un borrado o
 * una demo que se quedó sin eventos próximos se vuelva a completar sola. Si se
 * agregan filas al dataset, se suben estos números.
 */
const DATASET_MINS = {
  clients: CLIENTS.length,
  events: REAL_EVENTS_COUNT + RELATIVE_EVENTS_COUNT,
  tasks: (REAL_EVENTS_COUNT + RELATIVE_EVENTS_COUNT) * 4,
  budgets: 5,
  audits: 15,
} as const;

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
  { id: "demo_inv_panels", name: "Bastidor de piso para pantalla", category: "Estructuras", sku: "BAS-PISO", kind: "REUSABLE", status: "AVAILABLE", quantity: 18, replacementCost: 620_000, dailyCost: 18_000, notes: null },
] satisfies Array<{ id: string } & Omit<Prisma.InventoryItemUncheckedCreateInput, "id" | "organizationId">>;

const PROMOTERS = [
  { id: "demo_promoter_ana", name: "Ana Villalba", phone: "+595 981 445 210", email: "ana.villalba@ledbox.demo", specialties: "Activación de marca, degustación", active: true, notes: "Disponible los fines de semana." },
  { id: "demo_promoter_lorena", name: "Lorena Ríos", phone: "+595 983 220 118", email: "lorena.rios@ledbox.demo", specialties: "Registro de invitados, acreditaciones", active: true, notes: null },
  { id: "demo_promoter_mabel", name: "Mabel Acosta", phone: "+595 971 909 330", email: "mabel.acosta@ledbox.demo", specialties: "Fotografía y redes sociales", active: true, notes: "Lleva cámara propia." },
  { id: "demo_promoter_javier", name: "Javier Paredes", phone: "+595 985 771 042", email: "javier.paredes@ledbox.demo", specialties: "Montaje y soporte técnico", active: true, notes: null },
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
];

// ── Alta idempotente ────────────────────────────────────────────────────────

/**
 * Asegura la organización demo, el usuario demo y los datos simulados, y
 * devuelve el destino de la sesión demo. Es idempotente y re-ancla el dataset a
 * hoy (una vez por día o cuando la agenda quedó sin eventos futuros).
 */
export async function ensureDemoData(): Promise<DemoSessionTarget> {
  const base = todayBase();

  // El ancla del dataset es el `updatedAt` de la organización demo. Se lee ANTES
  // de tocar la organización para que una provisión a medias no se marque como
  // completa.
  let organization = await db.organization.findUnique({ where: { slug: DEMO_ORGANIZATION_SLUG } });
  const fresh = organization ? await demoDataIsFresh(organization) : false;
  if (!organization) {
    organization = await db.organization.create({ data: DEMO_ORGANIZATION });
  } else if (organization.name !== DEMO_ORGANIZATION_NAME || !organization.active) {
    organization = await db.organization.update({
      where: { id: organization.id },
      data: { name: DEMO_ORGANIZATION_NAME, active: true },
    });
  }

  // El usuario demo nunca inicia sesión con contraseña: la clave es aleatoria y
  // el único camino es `GET/POST /api/demo/session`. Su rol global es VIEWER.
  const user = await db.adminUser.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: {
      id: DEMO_USER_ID,
      name: DEMO_USER_NAME,
      email: DEMO_USER_EMAIL,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      role: "VIEWER",
      active: true,
    },
    update: { name: DEMO_USER_NAME, role: "VIEWER", active: true },
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
    await db.organization.update({ where: { id: organization.id }, data: { name: DEMO_ORGANIZATION_NAME } });
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
  const [clients, events, tasks, budgets, audits, upcoming] = await Promise.all([
    db.client.count({ where: { organizationId: organization.id } }),
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
  ]);
  const complete =
    clients >= DATASET_MINS.clients &&
    events >= DATASET_MINS.events &&
    tasks >= DATASET_MINS.tasks &&
    budgets >= DATASET_MINS.budgets &&
    audits >= DATASET_MINS.audits &&
    upcoming >= 3;
  if (!complete) return false;
  return dayKeyOf(organization.updatedAt) === dayKeyOf(new Date());
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
    status: eventStatusFrom(startsAt, endsAt, now, seed.draft),
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

/** Tareas del checklist derivadas del estado del evento (4 por evento). */
function buildTasks(event: BuiltEvent, index: number): Array<{ id: string; data: Omit<Prisma.EventTaskUncheckedCreateInput, "id"> }> {
  const inProgress = event.status === "IN_PROGRESS";
  const done = event.status === "COMPLETED";
  const setupDone = done || inProgress;
  const promoterId = index % 3 === 0 ? PROMOTER_IDS[0] : index % 3 === 1 ? PROMOTER_IDS[2] : null;
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

  const clientsData: Prisma.ClientUncheckedCreateInput[] = CLIENTS.map((client) => ({
    ...client,
    ...org,
    ruc: null,
    active: true,
    createdAt: at(base, -60, 9, 10),
  }));

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

  const promotersData: Prisma.PromoterUncheckedCreateInput[] = PROMOTERS.map((promoter) => ({
    ...promoter,
    ...org,
    createdAt: at(base, -90, 10, 0),
  }));

  const tasksData: Prisma.EventTaskUncheckedCreateInput[] = events
    .flatMap((event, index) => buildTasks(event, index))
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
  const next = upcoming[0];
  const second = upcoming[1];
  const third = upcoming[2];
  const last = upcoming[upcoming.length - 1];
  const recentPast = past[past.length - 1];
  const longestPast = past.reduce((best, event) => (event.durationDays > best.durationDays ? event : best), past[0]);
  const inProgress = events.find((event) => event.status === "IN_PROGRESS");
  if (!next || !second || !third || !last || !recentPast || !longestPast || !draft || !inProgress) {
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
  const jobsData: Prisma.SupplierJobUncheckedCreateInput[] = [
    { id: "demo_job_grafica", ...org, supplierId: "demo_supplier_grafica", eventId: next.id, category: "GRAPHICS", description: `Gráfica del stand · ${next.name}`, total: 2_400_000, advance: 1_200_000, status: "ADVANCE_PAID", dueAt: jobDue(next, 3, 12), notes: "Arte aprobado; retiran antes del montaje." },
    { id: "demo_job_escenario", ...org, supplierId: "demo_supplier_carpinteria", eventId: next.id, category: "CARPENTRY", description: `Escenario y mobiliario · ${next.name}`, total: 5_500_000, advance: 2_000_000, status: "IN_PRODUCTION", dueAt: jobDue(next, 2, 18), notes: "En taller; entrega el día previo al montaje." },
    { id: "demo_job_sonido", ...org, supplierId: "demo_supplier_audio", eventId: second.id, category: "AUDIOVISUAL", description: `Sonido e iluminación · ${second.name}`, total: 3_200_000, advance: 0, status: "CONTRACTED", dueAt: jobDue(second, 5, 9), notes: "Equipo reservado; falta la orden de compra." },
    { id: "demo_job_electrico", ...org, supplierId: "demo_supplier_electricidad", eventId: third.id, category: "ELECTRICITY", description: `Instalación eléctrica y tablero · ${third.name}`, total: 1_500_000, advance: 500_000, status: "IN_PRODUCTION", dueAt: jobDue(third, 4, 9), notes: "Tablero armado en taller." },
    { id: "demo_job_flete_feria", ...org, supplierId: "demo_supplier_transporte", eventId: longestPast.id, category: "TRANSPORT", description: `Flete, montaje y desmontaje · ${longestPast.name}`, total: 1_800_000, advance: 1_800_000, status: "PAID", dueAt: eventStart(longestPast, -2, 8), deliveredAt: eventStart(longestPast, 1, 17), paidAt: eventStart(longestPast, 4, 10), paymentMethod: "Transferencia", receipt: "REC-8812" },
    { id: "demo_job_hogar", ...org, supplierId: "demo_supplier_electricidad", eventId: recentPast.id, category: "ELECTRICITY", description: `Servicio eléctrico · ${recentPast.name}`, total: 1_200_000, advance: 1_200_000, status: "PAID", dueAt: eventStart(recentPast, -1, 6), deliveredAt: eventStart(recentPast, 0, 9), paidAt: pastInstant(withinMonth(base, 4, 15, 0), now), paymentMethod: "Transferencia", receipt: "REC-8820" },
    { id: "demo_job_stand_feria", ...org, supplierId: "demo_supplier_carpinteria", eventId: longestPast.id, category: "FURNITURE", description: `Stands y mobiliario · ${longestPast.name}`, total: 4_100_000, advance: 2_000_000, status: "DELIVERED", dueAt: pastInstant(withinMonth(base, 12, 9, 0), now), deliveredAt: eventStart(longestPast, 1, 7), notes: "Entregado en el predio; falta el saldo." },
    { id: "demo_job_balance", ...org, supplierId: "demo_supplier_audio", eventId: recentPast.id, category: "AUDIOVISUAL", description: `Refuerzo de sonido · ${recentPast.name}`, total: 2_600_000, advance: 1_000_000, status: "BALANCE_PENDING", dueAt: pastInstant(withinMonth(base, 5, 9, 0), now), deliveredAt: eventStart(recentPast, 0, 9), notes: "Saldo pendiente de facturación." },
    { id: "demo_job_lejano", ...org, supplierId: "demo_supplier_grafica", eventId: last.id, category: "GRAPHICS", description: `Vallas y gráfica · ${last.name}`, total: 3_600_000, advance: 0, status: "PENDING", dueAt: jobDue(last, 10, 12), notes: "Esperando el arte final del cliente." },
  ];

  // ── Presupuestos por rol (aprobado por portal, pendiente con link+QR, cambios pedidos) ──
  const budgetSeeds: Array<{
    id: string;
    event: BuiltEvent;
    title: string;
    status: "APPROVED" | "SENT" | "NEGOTIATING" | "DRAFT";
    discount: number;
    validUntil: Date;
    notes: string;
    token?: string;
    tokenCreatedAt?: Date;
    approval?: { at: Date; byName: string; method: "digital" | "manual"; ip?: string; userAgent?: string; note: string };
    revision?: { at: Date; note: string };
    createdAt: Date;
    items: Array<{ id: string; name: string; quantity: number; days: number; unitPrice: number; costPrice: number }>;
  }> = [
    {
      id: "demo_budget_aprobado",
      event: next,
      title: `Producción integral ${next.name}`,
      status: "APPROVED",
      discount: 1_400_000,
      validUntil: eventStart(next, -2, 18),
      notes: "Incluye pantallas, estructura y operación técnica. Montaje el día previo.",
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
  ];

  const budgetTotals = new Map<string, number>();
  const budgetsData: Prisma.BudgetUncheckedCreateInput[] = [];
  const budgetItemsData: Prisma.BudgetItemUncheckedCreateInput[] = [];
  for (const budget of budgetSeeds) {
    const subtotal = budget.items.reduce((sum, item) => sum + item.quantity * item.days * item.unitPrice, 0);
    const costEstimate = budget.items.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
    const total = Math.max(0, subtotal - budget.discount);
    budgetTotals.set(budget.id, total);
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

  // ── Cobros del mes (dos caen siempre en el mes en curso para el reporte) ──
  const totalOf = (id: string) => budgetTotals.get(id) ?? 0;
  const paidOf = totalOf("demo_budget_cobrado");
  const paymentsData: Prisma.ClientPaymentUncheckedCreateInput[] = [
    { id: "demo_pay_cobrado_1", ...org, clientId: longestPast.clientId, budgetId: "demo_budget_cobrado", amount: Math.round(paidOf / 2), paidAt: eventStart(longestPast, -10, 9, 40), method: "Transferencia", reference: "TRF-87990", notes: "Anticipo del cierre de feria." },
    { id: "demo_pay_cobrado_2", ...org, clientId: longestPast.clientId, budgetId: "demo_budget_cobrado", amount: paidOf - Math.round(paidOf / 2), paidAt: eventStart(longestPast, 2, 17, 10), method: "Transferencia", reference: "TRF-88105", notes: "Cancelación total." },
    { id: "demo_pay_cambios", ...org, clientId: third.clientId, budgetId: "demo_budget_cambios", amount: 2_000_000, paidAt: pastInstant(withinMonth(base, 8, 16, 0), now), method: "Cheque", reference: "CHQ-4471", notes: "Seña; el saldo se ajusta con los cambios pedidos." },
    { id: "demo_pay_aprobado", ...org, clientId: next.clientId, budgetId: "demo_budget_aprobado", amount: Math.round(totalOf("demo_budget_aprobado") * 0.4), paidAt: pastInstant(withinMonth(base, 6, 15, 30), now), method: "Transferencia", reference: "TRF-88213", notes: "Anticipo del 40%." },
    { id: "demo_pay_pendiente", ...org, clientId: second.clientId, budgetId: "demo_budget_pendiente", amount: 4_000_000, paidAt: pastInstant(withinMonth(base, 3, 11, 0), now), method: "Efectivo", reference: "REC-1042", notes: "Seña para reservar los equipos." },
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
    { id: "demo_asg_feria_paneles", eventId: longestPast.id, inventoryId: "demo_inv_panels", quantity: 8, startsAt: longestPast.setupAt, endsAt: longestPast.strikeAt, checkedOut: true, checkedIn: true, checkedOutAt: atDay(longestPast.setupAt, 0, 8, 15), checkedInAt: atDay(longestPast.strikeAt, 0, 10, 30), conditionOut: "Bueno", conditionIn: "Bueno" },
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
      await tx.client.createMany({ data: clientsData });
      await tx.event.createMany({ data: eventsData });
      await tx.promoter.createMany({ data: promotersData });
      await tx.eventTask.createMany({ data: tasksData });
      await tx.supplier.createMany({ data: suppliersData });
      await tx.supplierJob.createMany({ data: jobsData });
      await tx.budget.createMany({ data: budgetsData });
      await tx.budgetItem.createMany({ data: budgetItemsData });
      await tx.clientPayment.createMany({ data: paymentsData });
      await tx.inventoryItem.createMany({ data: inventoryData });
      await tx.eventInventory.createMany({ data: assignmentsData });
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
 * el dataset salga canónico. La organización, el usuario demo y sus sesiones no
 * se tocan.
 */
async function wipeDemoData(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.eventInventory.deleteMany({ where: { event: { organizationId } } });
  await tx.eventTask.deleteMany({ where: { event: { organizationId } } });
  await tx.clientPayment.deleteMany({ where: { organizationId } });
  await tx.budgetItem.deleteMany({ where: { budget: { organizationId } } });
  await tx.budget.deleteMany({ where: { organizationId } });
  await tx.quoteItem.deleteMany({ where: { quoteRequest: { organizationId } } });
  await tx.quoteRequest.deleteMany({ where: { organizationId } });
  await tx.lead.deleteMany({ where: { organizationId } });
  await tx.supplierJob.deleteMany({ where: { organizationId } });
  await tx.event.deleteMany({ where: { organizationId } });
  await tx.supplier.deleteMany({ where: { organizationId } });
  await tx.client.deleteMany({ where: { organizationId } });
  await tx.inventoryItem.deleteMany({ where: { organizationId } });
  await tx.promoter.deleteMany({ where: { organizationId } });
  await tx.auditLog.deleteMany({ where: { organizationId } });
}

// ── Auditoría ───────────────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  actor: DemoAuditActor;
  action: "create" | "update" | "delete" | "status" | "checkout" | "checkin" | "convert";
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
  const nextContact = clientContact(context.next.clientId);
  const thirdContact = clientContact(context.third.clientId);
  const rows: AuditRow[] = [
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
