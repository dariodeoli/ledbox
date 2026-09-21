import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { hashPassword } from "./auth";
import { DAY_MS, dayKeyOf, dayStart } from "./notifications";

/**
 * Demo pública (issue #14): organización «LedBox Demo» con datos simulados.
 *
 * El alta es **idempotente**: cada fila tiene un id determinístico y se escribe
 * con `upsert`, así que entrar a la demo las veces que sea no duplica nada.
 * Como las fechas del calendario y de los avisos tienen que verse vivas, cada
 * provisión re-ancla el dataset a HOY (zona America/Asuncion) y un ancla en
 * `Organization.updatedAt` evita repetir el trabajo el mismo día.
 *
 * La demo vive en su propia organización: el tenancy del panel filtra todas las
 * consultas por `organizationId`, así que ninguna sesión demo puede leer ni
 * escribir datos de otra empresa. Además la organización demo es de solo
 * lectura por contrato (ver `lib/server/tenancy.ts`).
 *
 * Los datos son ficticios y no guardan relación con clientes, proveedores ni
 * importes reales.
 */

export const DEMO_ORGANIZATION_ID = "org_demo";
export const DEMO_ORGANIZATION_SLUG = "demo";
export const DEMO_ORGANIZATION_NAME = "LedBox Demo";

export const DEMO_USER_ID = "demo_visitor";
export const DEMO_USER_EMAIL = "demo@ledbox.online";
export const DEMO_USER_NAME = "Visitante demo";

export const DEMO_MEMBERSHIP_ID = "demo_visitor_membership";

/** Asunción no aplica horario de verano desde 2024: el offset es fijo. */
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

// ── Fechas relativas a hoy (America/Asuncion) ───────────────────────────────

function todayBase(): Date {
  return dayStart(dayKeyOf(new Date()));
}

/** Instante a `days` días de hoy (`0` = hoy) a las `hour:minute` de Asunción. */
function at(base: Date, days: number, hour: number, minute = 0): Date {
  return new Date(base.getTime() + days * DAY_MS + (hour * 60 + minute) * 60_000);
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

/**
 * Mínimos del dataset simulado. El ancla del día se valida contra estos conteos
 * para que una provisión interrumpida (o un borrado) se vuelva a completar. Si
 * se agregan filas al dataset, se suben estos números.
 */
const DATASET_MINS = {
  clients: 6,
  budgets: 5,
  tasks: 20,
  audits: 13,
} as const;

type DemoAuditActor = { id: string; name: string; email: string };

const ACTORS = {
  sales: { id: "demo_user_valeria", name: "Valeria Ortiz", email: "valeria.ortiz@ledbox.demo" },
  ops: { id: "demo_user_marco", name: "Marco Ferreira", email: "marco.ferreira@ledbox.demo" },
  /** Aprobación del cliente desde el portal (mismo criterio que `portalAuditContext`). */
  portalMovistar: { id: "portal", name: "Lucía Fernández", email: "lucia.fernandez@movistar.com.py" },
  portalAtlas: { id: "portal", name: "Sofía Duarte", email: "sduarte@bancoatlas.com.py" },
} satisfies Record<string, DemoAuditActor>;

// ── Datos simulados ─────────────────────────────────────────────────────────

const CLIENTS = [
  {
    id: "demo_client_movistar",
    type: "RESELLER",
    name: "Lucía Fernández",
    company: "Movistar Paraguay",
    ruc: "80012345-6",
    email: "lucia.fernandez@movistar.com.py",
    phone: "+595 981 214 500",
    notes: "Cuenta mayorista: contrato marco firmado, facturación a 30 días.",
  },
  {
    id: "demo_client_hotel",
    type: "FINAL",
    name: "Marta Benítez",
    company: "Hotel Guaraní Asunción",
    ruc: "80045678-1",
    email: "eventos@hotelguarani.com.py",
    phone: "+595 983 110 220",
    notes: "Salón Guaraní y terraza; el montaje entra por el estacionamiento.",
  },
  {
    id: "demo_client_feria",
    type: "FINAL",
    name: "Luis Cáceres",
    company: "Cámara de Comercio de Asunción",
    ruc: "80098765-4",
    email: "lcaceres@ccasp.org.py",
    phone: "+595 971 330 400",
    notes: "Feria anual: tres pabellones y escenario central.",
  },
  {
    id: "demo_client_atlas",
    type: "FINAL",
    name: "Sofía Duarte",
    company: "Banco Atlas",
    ruc: "80022334-9",
    email: "sduarte@bancoatlas.com.py",
    phone: "+595 985 664 100",
    notes: "Expo interna de sucursales; pide evidencia fotográfica del montaje.",
  },
  {
    id: "demo_client_bavaria",
    type: "FINAL",
    name: "Rodrigo Núñez",
    company: "Cervecería Bavaria",
    ruc: "80033445-2",
    email: "rnunez@bavaria.com.py",
    phone: "+595 982 770 310",
    notes: "Activación de verano; coordinar con la agencia externa.",
  },
  {
    id: "demo_client_uca",
    type: "FINAL",
    name: "Gabriela Sosa",
    company: "Universidad Católica",
    ruc: "80011223-7",
    email: "gsosa@uca.edu.py",
    phone: "+595 991 555 808",
    notes: "Acto de graduación en el campus central.",
  },
] as const;

const SUPPLIERS = [
  {
    id: "demo_supplier_grafica",
    name: "Gráfica La Colmena",
    company: "Gráfica La Colmena S.A.",
    phone: "+595 21 445 900",
    email: "ventas@lacolmena.com.py",
    category: "GRAPHICS",
    paymentTerms: "50% de anticipo y saldo contra entrega",
    notes: "Banners, vinilos y cartelería. Entrega en 48 h.",
  },
  {
    id: "demo_supplier_carpinteria",
    name: "Carpintería Benítez",
    company: "Benítez Muebles y Estructuras",
    phone: "+595 984 220 118",
    email: "taller@carpinteriabenitez.com.py",
    category: "CARPENTRY",
    paymentTerms: "Anticipo 40%, saldo a 15 días",
    notes: "Escenarios, stands y mobiliario a medida.",
  },
  {
    id: "demo_supplier_transporte",
    name: "Transportes Ríos",
    company: "Ríos Logística",
    phone: "+595 971 808 260",
    email: "operaciones@transportesrios.com.py",
    category: "TRANSPORT",
    paymentTerms: "Contado contra entrega",
    notes: "Fletes con hidrogrúa para pantallas y truss.",
  },
  {
    id: "demo_supplier_audio",
    name: "Audio Sur",
    company: "Audio Sur Producciones",
    phone: "+595 982 664 901",
    email: "produccion@audiosur.com.py",
    category: "AUDIOVISUAL",
    paymentTerms: "Anticipo 30%, saldo al desmontaje",
    notes: "Sonido, iluminación y monitoreo.",
  },
  {
    id: "demo_supplier_electricidad",
    name: "Electricidad Meza",
    company: "Meza Servicios Eléctricos",
    phone: "+595 985 330 774",
    email: "contacto@electricidadmeza.com.py",
    category: "ELECTRICITY",
    paymentTerms: "Contado",
    notes: "Tableros, generadores y puesta a tierra.",
  },
] as const;

const INVENTORY = [
  {
    id: "demo_inv_led_p3",
    name: "Pantalla LED P3.9 500x500",
    category: "Pantallas LED",
    sku: "LED-P3-500",
    kind: "REUSABLE",
    status: "RESERVED",
    quantity: 40,
    replacementCost: 1_850_000,
    dailyCost: 45_000,
    notes: "Gabinetes con fuente y cableado; se guardan en el depósito.",
  },
  {
    id: "demo_inv_led_p5",
    name: "Pantalla LED P5 outdoor 960x960",
    category: "Pantallas LED",
    sku: "LED-P5-960",
    kind: "REUSABLE",
    status: "IN_USE",
    quantity: 24,
    replacementCost: 2_400_000,
    dailyCost: 60_000,
    notes: "Seis gabinetes afectados al pabellón de la feria.",
  },
  {
    id: "demo_inv_totem",
    name: "Tótem LED 2x1 m",
    category: "Tótems",
    sku: "TOT-LED-2X1",
    kind: "REUSABLE",
    status: "MAINTENANCE",
    quantity: 6,
    replacementCost: 3_200_000,
    dailyCost: 90_000,
    notes: "Un tótem volvió con el marco doblado (ver devolución de Expo Atlas).",
  },
  {
    id: "demo_inv_totem_touch",
    name: "Tótem Touch 43\"",
    category: "Tótems",
    sku: "TOT-TCH-43",
    kind: "REUSABLE",
    status: "AVAILABLE",
    quantity: 4,
    replacementCost: 4_100_000,
    dailyCost: 120_000,
    notes: "Con tótem de consulta y software de encuestas.",
  },
  {
    id: "demo_inv_kiosko",
    name: "Kiosko Touch 32\"",
    category: "Kioskos",
    sku: "KIO-32",
    kind: "REUSABLE",
    status: "AVAILABLE",
    quantity: 3,
    replacementCost: 3_600_000,
    dailyCost: 110_000,
    notes: null,
  },
  {
    id: "demo_inv_cilindro",
    name: "Cilindro LED 1.5 m",
    category: "Cilindros",
    sku: "CIL-15",
    kind: "REUSABLE",
    status: "AVAILABLE",
    quantity: 8,
    replacementCost: 2_200_000,
    dailyCost: 75_000,
    notes: null,
  },
  {
    id: "demo_inv_dispenser",
    name: "Dispensador inteligente",
    category: "Activaciones",
    sku: "DISP-01",
    kind: "REUSABLE",
    status: "AVAILABLE",
    quantity: 2,
    replacementCost: 1_100_000,
    dailyCost: 35_000,
    notes: "Dispensa premios con conteo por evento.",
  },
  {
    id: "demo_inv_cable",
    name: "Cable UTP Cat6 (rollo 100 m)",
    category: "Insumos",
    sku: "CBL-UTP6",
    kind: "CONSUMABLE",
    status: "AVAILABLE",
    quantity: 12,
    replacementCost: 180_000,
    dailyCost: 0,
    notes: null,
  },
  {
    id: "demo_inv_truss",
    name: "Estructura de truss 2 m",
    category: "Estructuras",
    sku: "TRS-2M",
    kind: "REUSABLE",
    status: "RESERVED",
    quantity: 30,
    replacementCost: 450_000,
    dailyCost: 12_000,
    notes: null,
  },
  {
    id: "demo_inv_panels",
    name: "Bastidor de piso para pantalla",
    category: "Estructuras",
    sku: "BAS-PISO",
    kind: "REUSABLE",
    status: "AVAILABLE",
    quantity: 18,
    replacementCost: 620_000,
    dailyCost: 18_000,
    notes: null,
  },
] satisfies Array<{ id: string } & Omit<Prisma.InventoryItemUncheckedCreateInput, "id" | "organizationId">>;

const PROMOTERS = [
  {
    id: "demo_promoter_ana",
    name: "Ana Villalba",
    phone: "+595 981 445 210",
    email: "ana.villalba@ledbox.demo",
    specialties: "Activación de marca, degustación",
    active: true,
    notes: "Disponible los fines de semana.",
  },
  {
    id: "demo_promoter_lorena",
    name: "Lorena Ríos",
    phone: "+595 983 220 118",
    email: "lorena.rios@ledbox.demo",
    specialties: "Registro de invitados, acreditaciones",
    active: true,
    notes: null,
  },
  {
    id: "demo_promoter_mabel",
    name: "Mabel Acosta",
    phone: "+595 971 909 330",
    email: "mabel.acosta@ledbox.demo",
    specialties: "Fotografía y redes sociales",
    active: true,
    notes: "Lleva cámara propia.",
  },
  {
    id: "demo_promoter_javier",
    name: "Javier Paredes",
    phone: "+595 985 771 042",
    email: "javier.paredes@ledbox.demo",
    specialties: "Montaje y soporte técnico",
    active: true,
    notes: null,
  },
] as const;

const LEADS = [
  {
    id: "demo_lead_gimenez",
    name: "Patricia Giménez",
    phone: "+595 981 300 700",
    email: "pgimenez@clinicasantaclara.com.py",
    company: "Clínica Santa Clara",
    ruc: "80055667-3",
    reason: "Evento de aniversario",
    message: "Necesitamos pantallas para el acto de aniversario y una pantalla de bienvenida.",
    status: "NEW",
    createdDays: -1,
    eventDateDays: 40,
    location: "Asunción",
  },
  {
    id: "demo_lead_ayala",
    name: "Roberto Ayala",
    phone: "+595 984 112 233",
    email: "rayala@constructoraayala.com.py",
    company: "Constructora Ayala",
    ruc: null,
    reason: "Lanzamiento de proyecto",
    message: "Lanzamos un barrio nuevo; queremos pantalla exterior y sonido.",
    status: "NEW",
    createdDays: -2,
    eventDateDays: 25,
    location: "Luque",
  },
  {
    id: "demo_lead_nunez",
    name: "Carla Núñez",
    phone: "+595 972 664 812",
    email: "carla.nunez@farmaciasdelsur.com.py",
    company: "Farmacias del Sur",
    ruc: "80066778-0",
    reason: "Apertura de sucursal",
    message: "Apertura de sucursal en Encarnación, con pantalla y tótem de consultas.",
    status: "CONTACTED",
    createdDays: -6,
    eventDateDays: 33,
    location: "Encarnación",
  },
  {
    id: "demo_lead_ocampos",
    name: "Diego Ocampos",
    phone: "+595 991 204 118",
    email: "diego.ocampos@agenciapixel.com.py",
    company: "Agencia Pixel",
    ruc: null,
    reason: "Producción de evento",
    message: "Alquiler de pantallas para tres fechas de una gira de marca.",
    status: "WON",
    createdDays: -20,
    eventDateDays: -4,
    location: "Asunción",
  },
  {
    id: "demo_lead_meza",
    name: "Sandra Meza",
    phone: "+595 983 991 004",
    email: "sandra.meza@redfarma.com.py",
    company: "Red Farma",
    ruc: null,
    reason: "Congreso interno",
    message: "Congreso de vendedores con pantalla principal y traducción.",
    status: "LOST",
    createdDays: -16,
    eventDateDays: 12,
    location: "San Bernardino",
  },
] as const;

// ── Alta idempotente ────────────────────────────────────────────────────────

/**
 * Asegura la organización demo, el usuario demo y los datos simulados, y
 * devuelve el destino de la sesión demo. Es idempotente y re-ancla las fechas a
 * hoy (una vez por día; el resto de las llamadas son lecturas).
 */
export async function ensureDemoData(): Promise<DemoSessionTarget> {
  const base = todayBase();

  // El ancla del dataset es el `updatedAt` de la organización demo: mientras sea
  // de hoy y haya datos, no se vuelve a escribir. Se lee ANTES de tocar la
  // organización para que una provisión a medias no se marque como completa.
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
  // el único camino es `POST/GET /api/demo/session`. Su rol global es VIEWER.
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

/** El dataset ya está anclado a hoy y completo: no hace falta reescribirlo. */
async function demoDataIsFresh(organization: { id: string; updatedAt: Date }): Promise<boolean> {
  // El ancla es el `updatedAt` de la organización, pero se combina con el
  // conteo mínimo del dataset: si una provisión se cortó a medias (o alguien
  // borró filas), el próximo ingreso vuelve a escribir todo.
  const [clients, budgets, tasks, audits] = await Promise.all([
    db.client.count({ where: { organizationId: organization.id } }),
    db.budget.count({ where: { organizationId: organization.id } }),
    db.eventTask.count({ where: { event: { organizationId: organization.id } } }),
    db.auditLog.count({ where: { organizationId: organization.id } }),
  ]);
  const complete =
    clients >= DATASET_MINS.clients &&
    budgets >= DATASET_MINS.budgets &&
    tasks >= DATASET_MINS.tasks &&
    audits >= DATASET_MINS.audits;
  if (!complete) return false;
  return dayKeyOf(organization.updatedAt) === dayKeyOf(new Date());
}

async function seedDemoData(organizationId: string, base: Date): Promise<void> {
  const org = { organizationId };

  // ── Clientes ──
  await Promise.all(
    CLIENTS.map((client) =>
      db.client.upsert({
        where: { id: client.id },
        create: { ...client, ...org, active: true, createdAt: at(base, -24, 9, 10) },
        update: { ...withoutId({ ...client }), ...org, active: true, createdAt: at(base, -24, 9, 10) },
      }),
    ),
  );

  // ── Eventos ──
  const events: Array<{ id: string; data: Omit<Prisma.EventUncheckedCreateInput, "id" | "organizationId"> }> = [
    {
      id: "demo_event_feria",
      data: {
        clientId: "demo_client_feria",
        name: "Feria de Asunción · Pabellón 2",
        location: "Pabellón 2, Mariano Roque Alonso",
        setupAt: at(base, 0, 8, 0),
        startsAt: at(base, 0, 14, 0),
        endsAt: at(base, 0, 22, 0),
        strikeAt: at(base, 1, 9, 0),
        status: "IN_PROGRESS",
        notes: "En curso: sonido e iluminación contratados con Audio Sur.",
      },
    },
    {
      id: "demo_event_atlas",
      data: {
        clientId: "demo_client_atlas",
        name: "Expo Sucursales Banco Atlas",
        location: "Hilton Garden Inn, Asunción",
        setupAt: at(base, -12, 18, 0),
        startsAt: at(base, -12, 20, 0),
        endsAt: at(base, -11, 13, 0),
        strikeAt: at(base, -11, 15, 0),
        status: "COMPLETED",
        notes: "Pendiente cobrar el saldo del cierre.",
      },
    },
    {
      id: "demo_event_graduacion",
      data: {
        clientId: "demo_client_uca",
        name: "Graduación Universidad Católica",
        location: "Campus Central, Aula Magna",
        setupAt: at(base, -20, 7, 0),
        startsAt: at(base, -20, 18, 0),
        endsAt: at(base, -20, 22, 0),
        strikeAt: at(base, -19, 8, 0),
        status: "COMPLETED",
        notes: "Evento cerrado y cobrado en su totalidad.",
      },
    },
    {
      id: "demo_event_lanzamiento",
      data: {
        clientId: "demo_client_movistar",
        name: "Lanzamiento Movistar 5G",
        location: "Centro de Convenciones, Asunción",
        setupAt: at(base, 3, 9, 0),
        startsAt: at(base, 3, 19, 0),
        endsAt: at(base, 3, 23, 0),
        strikeAt: at(base, 4, 8, 0),
        status: "CONFIRMED",
        notes: "Prensa 19:00 y show 20:30; vestidor para dos artistas.",
      },
    },
    {
      id: "demo_event_bavaria",
      data: {
        clientId: "demo_client_bavaria",
        name: "Activación Cervecería · Verano",
        location: "Costanera de Asunción",
        setupAt: at(base, 12, 10, 0),
        startsAt: at(base, 12, 16, 0),
        endsAt: at(base, 13, 0, 0),
        strikeAt: at(base, 14, 9, 0),
        status: "DRAFT",
        notes: "Borrador: falta confirmar la habilitación municipal.",
      },
    },
  ];
  await Promise.all(
    events.map((event) =>
      db.event.upsert({
        where: { id: event.id },
        create: { id: event.id, ...org, ...event.data },
        update: { ...org, ...event.data },
      }),
    ),
  );

  // ── Promotoras (antes del checklist: las tareas las referencian) ──
  await Promise.all(
    PROMOTERS.map((promoter) =>
      db.promoter.upsert({
        where: { id: promoter.id },
        create: { ...promoter, ...org, createdAt: at(base, -35, 10, 0) },
        update: { ...withoutId({ ...promoter }), ...org, createdAt: at(base, -35, 10, 0) },
      }),
    ),
  );

  // ── Checklist operativo (una tarea vencida en dos cobros) ──
  const tasks: Array<{ id: string; data: Omit<Prisma.EventTaskUncheckedCreateInput, "id"> }> = [
    { id: "demo_task_feria_setup", data: { eventId: "demo_event_feria", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueAt: at(base, 0, 7, 30), completedAt: at(base, 0, 8, 30) } },
    { id: "demo_task_feria_event", data: { eventId: "demo_event_feria", type: "EVENT", title: "Verificar equipos y operación del evento", dueAt: at(base, 0, 13, 0), completedAt: at(base, 0, 13, 20), promoterId: "demo_promoter_ana" } },
    { id: "demo_task_feria_strike", data: { eventId: "demo_event_feria", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueAt: at(base, 1, 8, 0), completedAt: null } },
    { id: "demo_task_feria_collection", data: { eventId: "demo_event_feria", type: "COLLECTION", title: "Confirmar cobro / saldo", dueAt: at(base, -1, 12, 0), completedAt: null, notes: "El comité de la feria aprobó la seña; falta el saldo." } },
    { id: "demo_task_atlas_setup", data: { eventId: "demo_event_atlas", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueAt: at(base, -13, 12, 0), completedAt: at(base, -13, 11, 30) } },
    { id: "demo_task_atlas_event", data: { eventId: "demo_event_atlas", type: "EVENT", title: "Verificar equipos y operación del evento", dueAt: at(base, -12, 18, 0), completedAt: at(base, -12, 18, 40) } },
    { id: "demo_task_atlas_strike", data: { eventId: "demo_event_atlas", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueAt: at(base, -11, 14, 0), completedAt: at(base, -11, 16, 30) } },
    { id: "demo_task_atlas_collection", data: { eventId: "demo_event_atlas", type: "COLLECTION", title: "Confirmar cobro / saldo", dueAt: at(base, -2, 12, 0), completedAt: null, notes: "Falta descontar el tótem dañado y cerrar el saldo." } },
    { id: "demo_task_graduacion_setup", data: { eventId: "demo_event_graduacion", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueAt: at(base, -21, 12, 0), completedAt: at(base, -21, 11, 0) } },
    { id: "demo_task_graduacion_event", data: { eventId: "demo_event_graduacion", type: "EVENT", title: "Verificar equipos y operación del evento", dueAt: at(base, -20, 16, 0), completedAt: at(base, -20, 16, 30) } },
    { id: "demo_task_graduacion_strike", data: { eventId: "demo_event_graduacion", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueAt: at(base, -19, 7, 0), completedAt: at(base, -19, 9, 15) } },
    { id: "demo_task_graduacion_collection", data: { eventId: "demo_event_graduacion", type: "COLLECTION", title: "Confirmar cobro / saldo", dueAt: at(base, -14, 12, 0), completedAt: at(base, -13, 17, 20) } },
    { id: "demo_task_lanzamiento_setup", data: { eventId: "demo_event_lanzamiento", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueAt: at(base, 2, 10, 0), completedAt: at(base, -2, 9, 15) } },
    { id: "demo_task_lanzamiento_event", data: { eventId: "demo_event_lanzamiento", type: "EVENT", title: "Verificar equipos y operación del evento", dueAt: at(base, 3, 16, 0), completedAt: null, promoterId: "demo_promoter_ana" } },
    { id: "demo_task_lanzamiento_strike", data: { eventId: "demo_event_lanzamiento", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueAt: at(base, 4, 7, 0), completedAt: null, promoterId: "demo_promoter_javier" } },
    { id: "demo_task_lanzamiento_collection", data: { eventId: "demo_event_lanzamiento", type: "COLLECTION", title: "Confirmar cobro / saldo", dueAt: at(base, 5, 12, 0), completedAt: null } },
    { id: "demo_task_bavaria_setup", data: { eventId: "demo_event_bavaria", type: "SETUP", title: "Confirmar montaje y acceso al lugar", dueAt: at(base, 11, 10, 0), completedAt: null, promoterId: "demo_promoter_javier" } },
    { id: "demo_task_bavaria_event", data: { eventId: "demo_event_bavaria", type: "EVENT", title: "Verificar equipos y operación del evento", dueAt: at(base, 12, 15, 0), completedAt: null, promoterId: "demo_promoter_mabel" } },
    { id: "demo_task_bavaria_strike", data: { eventId: "demo_event_bavaria", type: "STRIKE", title: "Coordinar desmontaje y devolución", dueAt: at(base, 14, 8, 0), completedAt: null } },
    { id: "demo_task_bavaria_collection", data: { eventId: "demo_event_bavaria", type: "COLLECTION", title: "Confirmar cobro / saldo", dueAt: at(base, 16, 12, 0), completedAt: null } },
  ];
  await Promise.all(
    tasks.map((task) =>
      db.eventTask.upsert({
        where: { id: task.id },
        create: { id: task.id, ...task.data },
        update: task.data,
      }),
    ),
  );

  // ── Proveedores y trabajos en todos los estados ──
  await Promise.all(
    SUPPLIERS.map((supplier) =>
      db.supplier.upsert({
        where: { id: supplier.id },
        create: { ...supplier, ...org, active: true, createdAt: at(base, -30, 9, 0) },
        update: { ...withoutId({ ...supplier }), ...org, active: true, createdAt: at(base, -30, 9, 0) },
      }),
    ),
  );

  const jobs: Array<{ id: string; data: Omit<Prisma.SupplierJobUncheckedCreateInput, "id" | "organizationId"> }> = [
    {
      id: "demo_job_grafica",
      data: { supplierId: "demo_supplier_grafica", eventId: "demo_event_lanzamiento", category: "GRAPHICS", description: "Banner 8x3 m, vinilos y cartelería", total: 2_400_000, advance: 1_200_000, status: "ADVANCE_PAID", dueAt: at(base, 2, 12, 0), notes: "Arte aprobado; retiran el jueves a las 15:00." },
    },
    {
      id: "demo_job_escenario",
      data: { supplierId: "demo_supplier_carpinteria", eventId: "demo_event_lanzamiento", category: "CARPENTRY", description: "Escenario 6x4 m con pasarela", total: 5_500_000, advance: 2_000_000, status: "IN_PRODUCTION", dueAt: at(base, 6, 18, 0), notes: "En taller; entrega el día previo al montaje." },
    },
    {
      id: "demo_job_flete_atlas",
      data: { supplierId: "demo_supplier_transporte", eventId: "demo_event_atlas", category: "TRANSPORT", description: "Flete, montaje y desmontaje", total: 1_800_000, advance: 1_800_000, status: "PAID", dueAt: at(base, -13, 8, 0), deliveredAt: at(base, -12, 17, 0), paidAt: at(base, -10, 10, 0), paymentMethod: "Transferencia", receipt: "REC-8812" },
    },
    {
      id: "demo_job_sonido",
      data: { supplierId: "demo_supplier_audio", eventId: "demo_event_feria", category: "AUDIOVISUAL", description: "Sonido e iluminación del pabellón", total: 3_200_000, advance: 0, status: "CONTRACTED", dueAt: at(base, -3, 9, 0), notes: "Equipo en el pabellón; factura pendiente." },
    },
    {
      id: "demo_job_electrico",
      data: { supplierId: "demo_supplier_electricidad", eventId: "demo_event_bavaria", category: "ELECTRICITY", description: "Instalación eléctrica y tablero", total: 1_500_000, advance: 500_000, status: "BALANCE_PENDING", dueAt: at(base, 9, 9, 0), deliveredAt: at(base, 7, 16, 0), notes: "Saldo contra entrega del tablero." },
    },
    {
      id: "demo_job_stand",
      data: { supplierId: "demo_supplier_carpinteria", eventId: "demo_event_feria", category: "FURNITURE", description: "Mobiliario y stands del pabellón", total: 4_100_000, advance: 2_000_000, status: "DELIVERED", dueAt: at(base, -1, 8, 0), deliveredAt: at(base, -1, 7, 40), notes: "Entregado en el pabellón; falta el saldo." },
    },
    {
      id: "demo_job_vallas",
      data: { supplierId: "demo_supplier_grafica", eventId: "demo_event_bavaria", category: "GRAPHICS", description: "Vallas y gráfica de escenario", total: 3_600_000, advance: 0, status: "PENDING", dueAt: at(base, 14, 12, 0), notes: "Esperando el arte final de la agencia." },
    },
    {
      id: "demo_job_electrico_uca",
      data: { supplierId: "demo_supplier_electricidad", eventId: "demo_event_graduacion", category: "ELECTRICITY", description: "Servicio eléctrico del acto", total: 1_200_000, advance: 1_200_000, status: "PAID", dueAt: at(base, -21, 6, 0), deliveredAt: at(base, -20, 22, 30), paidAt: at(base, -9, 15, 0), paymentMethod: "Efectivo", receipt: "REC-8804" },
    },
  ];
  await Promise.all(
    jobs.map((job) =>
      db.supplierJob.upsert({
        where: { id: job.id },
        create: { id: job.id, ...org, ...job.data },
        update: { ...org, ...job.data },
      }),
    ),
  );

  // ── Presupuestos (aprobado por el portal, pendiente con link, cambios pedidos) ──
  const budgets: Array<{ id: string; items: Array<{ id: string; data: Omit<Prisma.BudgetItemUncheckedCreateInput, "id" | "budgetId"> }>; data: Omit<Prisma.BudgetUncheckedCreateInput, "id" | "organizationId" | "items"> }> = [
    {
      id: "demo_budget_lanzamiento",
      data: {
        clientId: "demo_client_movistar",
        eventId: "demo_event_lanzamiento",
        title: "Producción integral Lanzamiento 5G",
        status: "APPROVED",
        subtotal: 32_400_000,
        discount: 1_400_000,
        total: 31_000_000,
        costEstimate: 13_200_000,
        validUntil: at(base, 10, 18, 0),
        notes: "Incluye pantallas P3.9, tótem LED y sonido. Montaje el día previo.",
        publicToken: "D3M9-5G97-4XKW-2M8R-T3HN",
        publicTokenCreatedAt: at(base, -5, 10, 0),
        approvedAt: at(base, -2, 16, 30),
        approvedByName: "Lucía Fernández",
        approvalMethod: "digital",
        approvalIp: "190.10.20.30",
        approvalUserAgent: "Mozilla/5.0 (Linux; Android 14; LedBox Demo)",
        approvalNote: "Aprobado; mantengan el horario de montaje de las 09:00.",
        createdAt: at(base, -9, 11, 5),
      },
      items: [
        { id: "demo_budget_item_l1", data: { name: "Pantalla LED P3.9 500x500 (m²)", quantity: 20, days: 1, unitPrice: 950_000, costPrice: 380_000, subtotal: 19_000_000 } },
        { id: "demo_budget_item_l2", data: { name: "Tótem LED 2x1 m", quantity: 2, days: 1, unitPrice: 1_800_000, costPrice: 700_000, subtotal: 3_600_000 } },
        { id: "demo_budget_item_l3", data: { name: "Sonido e iluminación de escenario", quantity: 1, days: 1, unitPrice: 6_500_000, costPrice: 3_000_000, subtotal: 6_500_000 } },
        { id: "demo_budget_item_l4", data: { name: "Operación técnica y montaje", quantity: 1, days: 2, unitPrice: 1_650_000, costPrice: 600_000, subtotal: 3_300_000 } },
      ],
    },
    {
      id: "demo_budget_feria",
      data: {
        clientId: "demo_client_feria",
        eventId: "demo_event_feria",
        title: "Alquiler de pantallas Feria de Asunción",
        status: "SENT",
        subtotal: 14_800_000,
        discount: 0,
        total: 14_800_000,
        costEstimate: 6_100_000,
        validUntil: at(base, 5, 18, 0),
        notes: "Pendiente de aprobación por el comité de la feria.",
        publicToken: "D3M9-F3R4-A2PY-Q7SC-K4VT",
        publicTokenCreatedAt: at(base, -1, 9, 15),
        // Abierto: el re-anclaje diario restaura el estado si un visitante lo aprueba desde el portal.
        approvedAt: null,
        approvedByName: null,
        approvalMethod: null,
        approvalIp: null,
        approvalUserAgent: null,
        approvalNote: null,
        revisionRequestedAt: null,
        revisionNote: null,
        createdAt: at(base, -5, 9, 20),
      },
      items: [
        { id: "demo_budget_item_f1", data: { name: "Pantalla LED P5 outdoor 960x960", quantity: 6, days: 2, unitPrice: 800_000, costPrice: 320_000, subtotal: 9_600_000 } },
        { id: "demo_budget_item_f2", data: { name: "Estructura de truss 2 m", quantity: 10, days: 2, unitPrice: 200_000, costPrice: 80_000, subtotal: 4_000_000 } },
        { id: "demo_budget_item_f3", data: { name: "Operación técnica", quantity: 1, days: 2, unitPrice: 600_000, costPrice: 250_000, subtotal: 1_200_000 } },
      ],
    },
    {
      id: "demo_budget_atlas",
      data: {
        clientId: "demo_client_atlas",
        eventId: "demo_event_atlas",
        title: "Stands Banco Atlas Expo",
        status: "NEGOTIATING",
        subtotal: 9_800_000,
        discount: 300_000,
        total: 9_500_000,
        costEstimate: 4_200_000,
        validUntil: at(base, 8, 18, 0),
        notes: "El cliente pidió mover el montaje y sumar dos tótems touch.",
        publicToken: "D3M9-B4NK-5T4N-D8XM-J2QZ",
        publicTokenCreatedAt: at(base, -6, 10, 30),
        // Abierto: el re-anclaje diario restaura el pedido de cambios original.
        approvedAt: null,
        approvedByName: null,
        approvalMethod: null,
        approvalIp: null,
        approvalUserAgent: null,
        approvalNote: null,
        revisionRequestedAt: at(base, -1, 11, 20),
        revisionNote: "Necesitamos mover el montaje al jueves y sumar dos tótems touch.",
        createdAt: at(base, -8, 15, 40),
      },
      items: [
        { id: "demo_budget_item_a1", data: { name: "Stand modular 3x3 m", quantity: 2, days: 2, unitPrice: 1_900_000, costPrice: 800_000, subtotal: 7_600_000 } },
        { id: "demo_budget_item_a2", data: { name: "Tótem Touch 43\"", quantity: 1, days: 2, unitPrice: 1_100_000, costPrice: 450_000, subtotal: 2_200_000 } },
      ],
    },
    {
      id: "demo_budget_graduacion",
      data: {
        clientId: "demo_client_uca",
        eventId: "demo_event_graduacion",
        title: "Acto de graduación · pantallas y sonido",
        status: "APPROVED",
        subtotal: 12_500_000,
        discount: 0,
        total: 12_500_000,
        costEstimate: 5_000_000,
        validUntil: at(base, -15, 18, 0),
        notes: "Aprobado por correo y confirmado por teléfono.",
        approvedAt: at(base, -25, 10, 0),
        approvedByName: "Gabriela Sosa",
        approvalMethod: "manual",
        approvalNote: "Confirmado por teléfono; se emite orden de trabajo.",
        createdAt: at(base, -27, 9, 30),
      },
      items: [
        { id: "demo_budget_item_g1", data: { name: "Pantalla LED P3.9 500x500", quantity: 10, days: 1, unitPrice: 800_000, costPrice: 340_000, subtotal: 8_000_000 } },
        { id: "demo_budget_item_g2", data: { name: "Sonido profesional", quantity: 1, days: 1, unitPrice: 3_000_000, costPrice: 1_300_000, subtotal: 3_000_000 } },
        { id: "demo_budget_item_g3", data: { name: "Operación técnica", quantity: 1, days: 2, unitPrice: 750_000, costPrice: 300_000, subtotal: 1_500_000 } },
      ],
    },
    {
      id: "demo_budget_bavaria",
      data: {
        clientId: "demo_client_bavaria",
        eventId: "demo_event_bavaria",
        title: "Activación Cervecería · Verano",
        status: "DRAFT",
        subtotal: 8_800_000,
        discount: 0,
        total: 8_800_000,
        costEstimate: 3_600_000,
        validUntil: at(base, 18, 18, 0),
        notes: "Borrador a la espera de la habilitación municipal.",
        approvedAt: null,
        approvedByName: null,
        approvalMethod: null,
        approvalIp: null,
        approvalUserAgent: null,
        approvalNote: null,
        revisionRequestedAt: null,
        revisionNote: null,
        createdAt: at(base, -3, 16, 10),
      },
      items: [
        { id: "demo_budget_item_b1", data: { name: "Cilindro LED 1.5 m", quantity: 4, days: 2, unitPrice: 950_000, costPrice: 380_000, subtotal: 7_600_000 } },
        { id: "demo_budget_item_b2", data: { name: "Dispensador inteligente", quantity: 1, days: 2, unitPrice: 600_000, costPrice: 240_000, subtotal: 1_200_000 } },
      ],
    },
  ];
  for (const budget of budgets) {
    await db.budget.upsert({
      where: { id: budget.id },
      create: { id: budget.id, ...org, ...budget.data },
      update: { ...org, ...budget.data },
    });
    await Promise.all(
      budget.items.map((item) =>
        db.budgetItem.upsert({
          where: { id: item.id },
          create: { id: item.id, budgetId: budget.id, ...item.data },
          update: item.data,
        }),
      ),
    );
  }

  // ── Cobros del mes ──
  const payments: Array<{ id: string; data: Omit<Prisma.ClientPaymentUncheckedCreateInput, "id" | "organizationId"> }> = [
    { id: "demo_pay_graduacion_1", data: { clientId: "demo_client_uca", budgetId: "demo_budget_graduacion", amount: 6_250_000, paidAt: at(base, -18, 9, 40), method: "Transferencia", reference: "TRF-87990", notes: "Primer pago del acto de graduación." } },
    { id: "demo_pay_graduacion_2", data: { clientId: "demo_client_uca", budgetId: "demo_budget_graduacion", amount: 6_250_000, paidAt: at(base, -13, 17, 10), method: "Transferencia", reference: "TRF-88105", notes: "Cancelación total." } },
    { id: "demo_pay_atlas", data: { clientId: "demo_client_atlas", budgetId: "demo_budget_atlas", amount: 2_000_000, paidAt: at(base, -8, 16, 0), method: "Cheque", reference: "CHQ-4471", notes: "Seña; el saldo se ajusta con los cambios pedidos." } },
    { id: "demo_pay_lanzamiento", data: { clientId: "demo_client_movistar", budgetId: "demo_budget_lanzamiento", amount: 12_400_000, paidAt: at(base, -6, 15, 30), method: "Transferencia", reference: "TRF-88213", notes: "Anticipo del 40%." } },
    { id: "demo_pay_feria", data: { clientId: "demo_client_feria", budgetId: "demo_budget_feria", amount: 4_000_000, paidAt: at(base, -4, 11, 0), method: "Efectivo", reference: "REC-1042", notes: "Seña para reservar los equipos." } },
  ];
  await Promise.all(
    payments.map((payment) =>
      db.clientPayment.upsert({
        where: { id: payment.id },
        create: { id: payment.id, ...org, ...payment.data },
        update: { ...org, ...payment.data },
      }),
    ),
  );

  // ── Inventario y asignaciones (una con salida y devolución con daño) ──
  await Promise.all(
    INVENTORY.map((item) =>
      db.inventoryItem.upsert({
        where: { id: item.id },
        create: { ...item, ...org, createdAt: at(base, -40, 9, 0) },
        update: { ...withoutId({ ...item }), ...org, createdAt: at(base, -40, 9, 0) },
      }),
    ),
  );

  const assignments: Array<{ id: string; data: Omit<Prisma.EventInventoryUncheckedCreateInput, "id"> }> = [
    { id: "demo_asg_lanzamiento_led", data: { eventId: "demo_event_lanzamiento", inventoryId: "demo_inv_led_p3", quantity: 20, startsAt: at(base, 3, 9, 0), endsAt: at(base, 4, 14, 0), checkedOut: false, checkedIn: false } },
    { id: "demo_asg_lanzamiento_truss", data: { eventId: "demo_event_lanzamiento", inventoryId: "demo_inv_truss", quantity: 12, startsAt: at(base, 3, 9, 0), endsAt: at(base, 4, 14, 0), checkedOut: false, checkedIn: false } },
    { id: "demo_asg_feria_p5", data: { eventId: "demo_event_feria", inventoryId: "demo_inv_led_p5", quantity: 12, startsAt: at(base, 0, 8, 0), endsAt: at(base, 1, 12, 0), checkedOut: true, checkedIn: false, checkedOutAt: at(base, 0, 8, 20), conditionOut: "Bueno" } },
    { id: "demo_asg_atlas_totem", data: { eventId: "demo_event_atlas", inventoryId: "demo_inv_totem", quantity: 3, startsAt: at(base, -12, 17, 0), endsAt: at(base, -11, 16, 0), checkedOut: true, checkedIn: true, checkedOutAt: at(base, -12, 17, 10), checkedInAt: at(base, -11, 16, 20), conditionOut: "Bueno", conditionIn: "Con daño: marco doblado", damagedQuantity: 1, missingQuantity: 0, damageNotes: "Un tótem volvió con el marco doblado; queda en mantenimiento y se descuenta del saldo." } },
    { id: "demo_asg_atlas_panels", data: { eventId: "demo_event_atlas", inventoryId: "demo_inv_panels", quantity: 8, startsAt: at(base, -12, 17, 0), endsAt: at(base, -11, 16, 0), checkedOut: true, checkedIn: true, checkedOutAt: at(base, -12, 17, 15), checkedInAt: at(base, -11, 16, 30), conditionOut: "Bueno", conditionIn: "Bueno" } },
    { id: "demo_asg_graduacion_touch", data: { eventId: "demo_event_graduacion", inventoryId: "demo_inv_totem_touch", quantity: 2, startsAt: at(base, -20, 7, 0), endsAt: at(base, -19, 9, 0), checkedOut: true, checkedIn: true, checkedOutAt: at(base, -20, 7, 20), checkedInAt: at(base, -19, 10, 0), conditionOut: "Bueno", conditionIn: "Bueno" } },
  ];
  await Promise.all(
    assignments.map((assignment) =>
      db.eventInventory.upsert({
        where: { id: assignment.id },
        create: { id: assignment.id, ...assignment.data },
        update: assignment.data,
      }),
    ),
  );

  // ── Leads del sitio (con un pedido de cotización) ──
  await Promise.all(
    LEADS.map((lead) =>
      db.lead.upsert({
        where: { id: lead.id },
        create: {
          id: lead.id,
          ...org,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          company: lead.company,
          ruc: lead.ruc,
          reason: lead.reason,
          message: lead.message,
          location: lead.location,
          status: lead.status,
          source: "website",
          consentAt: at(base, lead.createdDays, 9, 0),
          createdAt: at(base, lead.createdDays, 9, 0),
          eventDate: at(base, lead.eventDateDays, 12, 0),
          internalNotes: lead.status === "NEW" ? null : "Contacto registrado por el equipo comercial (dato simulado).",
        },
        update: {
          ...org,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          company: lead.company,
          ruc: lead.ruc,
          reason: lead.reason,
          message: lead.message,
          location: lead.location,
          status: lead.status,
          source: "website",
          consentAt: at(base, lead.createdDays, 9, 0),
          createdAt: at(base, lead.createdDays, 9, 0),
          eventDate: at(base, lead.eventDateDays, 12, 0),
          internalNotes: lead.status === "NEW" ? null : "Contacto registrado por el equipo comercial (dato simulado).",
        },
      }),
    ),
  );

  await db.quoteRequest.upsert({
    where: { id: "demo_quote_gimenez" },
    create: {
      id: "demo_quote_gimenez",
      ...org,
      leadId: "demo_lead_gimenez",
      referenceTotal: 15_000_000,
      currency: "PYG",
      durationDays: 1,
      eventDate: at(base, 40, 12, 0),
      location: "Asunción",
      source: "website",
      createdAt: at(base, -1, 9, 12),
      items: {
        create: [
          { id: "demo_quote_item_1", productSlug: "pantalla-led-p3-500", productName: "Pantalla LED P3.9 500x500", quantity: 12, duration: 1, billingUnit: "DAILY", unitPrice: 950_000, subtotal: 11_400_000 },
          { id: "demo_quote_item_2", productSlug: "totem-led-2x1", productName: "Tótem LED 2x1 m", quantity: 2, duration: 1, billingUnit: "DAILY", unitPrice: 1_800_000, subtotal: 3_600_000 },
        ],
      },
    },
    update: {
      ...org,
      leadId: "demo_lead_gimenez",
      referenceTotal: 15_000_000,
      durationDays: 1,
      eventDate: at(base, 40, 12, 0),
      location: "Asunción",
      createdAt: at(base, -1, 9, 12),
    },
  });

  // ── Auditoría coherente con las altas de arriba ──
  await seedAuditTrail(organizationId, base);
}

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

async function seedAuditTrail(organizationId: string, base: Date): Promise<void> {
  const rows: AuditRow[] = [
    {
      id: "demo_audit_client_movistar",
      actor: ACTORS.sales,
      action: "create",
      entity: "Client",
      entityId: "demo_client_movistar",
      summary: "Creó el cliente «Movistar Paraguay»",
      days: -24,
      hour: 9,
      minute: 10,
      detail: { fields: { name: "Lucía Fernández", company: "Movistar Paraguay", type: "RESELLER", phone: "+595 981 214 500" } },
    },
    {
      id: "demo_audit_event_lanzamiento",
      actor: ACTORS.ops,
      action: "create",
      entity: "Event",
      entityId: "demo_event_lanzamiento",
      summary: "Creó el evento «Lanzamiento Movistar 5G» del cliente «Movistar Paraguay»",
      days: -20,
      hour: 15,
      minute: 30,
      detail: { fields: { name: "Lanzamiento Movistar 5G", location: "Centro de Convenciones, Asunción", status: "DRAFT" } },
    },
    {
      id: "demo_audit_budget_lanzamiento",
      actor: ACTORS.sales,
      action: "create",
      entity: "Budget",
      entityId: "demo_budget_lanzamiento",
      summary: "Creó el presupuesto «Producción integral Lanzamiento 5G» del cliente «Movistar Paraguay»",
      days: -9,
      hour: 11,
      minute: 5,
      detail: { fields: { title: "Producción integral Lanzamiento 5G", status: "DRAFT", subtotal: 32_400_000, discount: 1_400_000, total: 31_000_000, items: 4 } },
    },
    {
      id: "demo_audit_job_grafica",
      actor: ACTORS.ops,
      action: "create",
      entity: "SupplierJob",
      entityId: "demo_job_grafica",
      summary: "Cargó el trabajo «Banner 8x3 m, vinilos y cartelería» del proveedor «Gráfica La Colmena»",
      days: -8,
      hour: 10,
      minute: 20,
      detail: { fields: { description: "Banner 8x3 m, vinilos y cartelería", total: 2_400_000, advance: 1_200_000, status: "CONTRACTED" } },
    },
    {
      id: "demo_audit_pay_atlas",
      actor: ACTORS.sales,
      action: "create",
      entity: "ClientPayment",
      entityId: "demo_pay_atlas",
      summary: "Registró un cobro del cliente «Banco Atlas»",
      days: -8,
      hour: 16,
      minute: 5,
      detail: { fields: { amount: 2_000_000, method: "Cheque", reference: "CHQ-4471" } },
    },
    {
      id: "demo_audit_pay_lanzamiento",
      actor: ACTORS.sales,
      action: "create",
      entity: "ClientPayment",
      entityId: "demo_pay_lanzamiento",
      summary: "Registró un cobro del cliente «Movistar Paraguay»",
      days: -6,
      hour: 15,
      minute: 35,
      detail: { fields: { amount: 12_400_000, method: "Transferencia", reference: "TRF-88213" } },
    },
    {
      id: "demo_audit_budget_feria",
      actor: ACTORS.sales,
      action: "create",
      entity: "Budget",
      entityId: "demo_budget_feria",
      summary: "Creó el presupuesto «Alquiler de pantallas Feria de Asunción» del cliente «Cámara de Comercio de Asunción»",
      days: -5,
      hour: 9,
      minute: 20,
      detail: { fields: { title: "Alquiler de pantallas Feria de Asunción", status: "DRAFT", total: 14_800_000, items: 3 } },
    },
    {
      id: "demo_audit_lead_nunez",
      actor: ACTORS.sales,
      action: "status",
      entity: "Lead",
      entityId: "demo_lead_nunez",
      summary: "Cambió el estado del lead «Carla Núñez»",
      days: -4,
      hour: 12,
      minute: 25,
      detail: { changes: { status: { from: "NEW", to: "CONTACTED" } } },
    },
    {
      id: "demo_audit_assignment_totem",
      actor: ACTORS.ops,
      action: "create",
      entity: "EventInventory",
      entityId: "demo_asg_atlas_totem",
      summary: "Asignó «Tótem LED 2x1 m» a «Expo Sucursales Banco Atlas» (3 unidades)",
      days: -12,
      hour: 16,
      minute: 40,
      detail: { fields: { quantity: 3, eventId: "demo_event_atlas", inventoryId: "demo_inv_totem" } },
    },
    {
      id: "demo_audit_checkin_totem",
      actor: ACTORS.ops,
      action: "status",
      entity: "EventInventory",
      entityId: "demo_asg_atlas_totem",
      summary: "Actualizó el movimiento de «Tótem LED 2x1 m» en «Expo Sucursales Banco Atlas»",
      days: -11,
      hour: 16,
      minute: 25,
      detail: { changes: { conditionIn: { from: null, to: "Con daño: marco doblado" } } },
    },
    {
      id: "demo_audit_approve_lanzamiento",
      actor: ACTORS.portalMovistar,
      action: "status",
      entity: "Budget",
      entityId: "demo_budget_lanzamiento",
      summary: "El cliente «Lucía Fernández» aprobó el presupuesto «Producción integral Lanzamiento 5G» desde el portal",
      days: -2,
      hour: 16,
      minute: 31,
      detail: { fields: { approvalMethod: "digital" } },
    },
    {
      id: "demo_audit_job_electrico",
      actor: ACTORS.ops,
      action: "status",
      entity: "SupplierJob",
      entityId: "demo_job_electrico",
      summary: "Cambió el estado del trabajo «Instalación eléctrica y tablero»",
      days: -1,
      hour: 8,
      minute: 50,
      detail: { changes: { status: { from: "CONTRACTED", to: "BALANCE_PENDING" } } },
    },
    {
      id: "demo_audit_revision_atlas",
      actor: ACTORS.portalAtlas,
      action: "status",
      entity: "Budget",
      entityId: "demo_budget_atlas",
      summary: "El cliente «Sofía Duarte» pidió cambios en el presupuesto «Stands Banco Atlas Expo» desde el portal",
      days: -1,
      hour: 11,
      minute: 22,
      detail: { fields: { revisionRequestedAt: true } },
    },
  ];

  await Promise.all(
    rows.map((row) =>
      db.auditLog.upsert({
        where: { id: row.id },
        create: {
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
        },
        update: {
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
        },
      }),
    ),
  );
}
