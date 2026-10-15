import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { EventStatus } from "@prisma/client";
import { sinStockMensaje, type EventoDoc, type EventoEstado, type EventoProblem } from "@/lib/import-eventos";
import { db } from "./db";
import { recordAudit } from "./audit";
import {
  MAINTENANCE_UNITS_SELECT,
  EVENT_RANGE_SELECT,
  type AssignmentRecord,
  buildAvailability,
  commitInventoryAssignment,
  committedAssignmentWhere,
  extendedRentalRange,
  loadRentalSettings,
  maintenanceUnits,
  overlaps,
  releaseAssignment,
  resolveRentalBuffers,
} from "./inventory-availability";
import { loadComboDefinitions } from "./inventory-combos";
import { findMatchingClient, type ClientCandidate } from "./lead-client";
import { dayStart, nextDayKey } from "./notifications";
import { lockedEventLimitViolation, planLimitViolation } from "./plan-limits";
import type { AdminContext } from "./tenancy";

/**
 * Importación de eventos con productos (Eventos → Importar): vista previa y aplicación.
 *
 * Decisiones (docs/IMPORTAR-EMPRESA.md «Eventos y reservas»):
 * - Clave del evento: su `codigo`. Como `Event` no tiene columna para eso (y no hay migración),
 *   el vínculo código → evento vive en `IdempotencyKey` (scope `import:evento`, sin vencimiento
 *   práctico). Un evento que se mandó a la papelera deja de existir para la importación: el mismo
 *   código crea uno nuevo.
 * - Reservas: SIEMPRE por `commitInventoryAssignment` (lock del ítem + disponibilidad dentro de la
 *   transacción), la misma función que la asignación manual. Nunca se sobrevende.
 * - Sin stock: la línea NO se reserva (todo o nada por línea, como la asignación manual), el evento
 *   se crea/actualiza igual con las líneas que sí entran y la que falta queda avisada en el
 *   resultado y en las notas del evento.
 * - Un SKU inexistente o un juego incompleto bloquean el evento entero (nada se escribe).
 * - Reimportar nunca quita productos que el archivo ya no trae (pueden haberse cargado a mano):
 *   solo agrega o actualiza líneas y avisa cuáles quedaron sin tocar. `cancelado` sí libera todo.
 */

export const IMPORT_EVENTO_SCOPE = "import:evento";
const FOREVER = new Date("2100-01-01T00:00:00.000Z");
const NOTES_BLOCK = "[Importación]";

export type LineaModo = "reservar" | "retener" | "sin-reserva" | "liberar";

export type LineaPlan = {
  codigo: string;
  cantidad: number;
  nombre: string;
  inventoryId: string | null;
  esCombo: boolean;
  modo: LineaModo;
  /** Estimación de la vista previa: unidades libres en esas fechas (null = no estimado). */
  libres: number | null;
  sinStock: boolean;
  mensaje: string | null;
};

export type EventoPlan = {
  doc: EventoDoc;
  accion: "crear" | "actualizar" | "omitir";
  existingId: string | null;
  cliente: { id: string | null; nuevo: boolean; nombre: string };
  lineas: LineaPlan[];
  startsAt: Date;
  endsAt: Date;
};

export type EventosSummary = {
  crear: number;
  actualizar: number;
  omitidos: number;
  clientesNuevos: number;
  lineasReservadas: number;
  lineasSinStock: number;
  lineasSinReserva: number;
  errores: number;
};

export type EventosPlanResult = { items: EventoPlan[]; problems: EventoProblem[]; summary: EventosSummary };

const STATUS_OF: Record<EventoEstado, EventStatus> = { confirmado: "CONFIRMED", borrador: "DRAFT", tentativo: "DRAFT", cancelado: "CANCELLED" };

const normalizeName = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const problem = (nivel: EventoProblem["nivel"], tipo: EventoProblem["tipo"], codigo: string | null, fila: number | null, mensaje: string): EventoProblem => ({ nivel, tipo, codigo, fila, mensaje });

/** Rango del evento en la zona horaria de la empresa: desde 00:00 del primer día hasta 23:59 del último. */
export function eventoRange(desde: string, hasta: string): { startsAt: Date; endsAt: Date } {
  return { startsAt: dayStart(desde), endsAt: new Date(dayStart(nextDayKey(hasta)).getTime() - 60_000) };
}

type ClientRow = ClientCandidate & { virtual?: boolean };

/** Cliente de un evento: por correo o teléfono normalizados; sin ninguno de los dos, por nombre exacto. */
function matchClient(candidates: readonly ClientRow[], cliente: EventoDoc["cliente"]): ClientRow | undefined {
  if (cliente.correo || cliente.telefono) return findMatchingClient(candidates, { email: cliente.correo ?? "", phone: cliente.telefono ?? "" });
  const name = normalizeName(cliente.nombre);
  return candidates.find((candidate) => normalizeName(candidate.name) === name || (candidate.company ? normalizeName(candidate.company) === name : false));
}

function stripBlock(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const at = notes.indexOf(`\n\n${NOTES_BLOCK}`);
  const base = (at >= 0 ? notes.slice(0, at) : notes.startsWith(NOTES_BLOCK) ? "" : notes).trim();
  return base || null;
}

function composeNotes(base: string | null, block: string[]): string | null {
  const text = [base, block.length ? `${NOTES_BLOCK}\n${block.join("\n")}` : null].filter(Boolean).join("\n\n");
  return text ? text.slice(0, 2000) : null;
}

const ITEM_SELECT = {
  id: true,
  sku: true,
  name: true,
  quantity: true,
  status: true,
  comboIncomplete: true,
  incidentHold: true,
  bufferBeforeMin: true,
  bufferAfterMin: true,
  _count: { select: MAINTENANCE_UNITS_SELECT },
} satisfies Prisma.InventoryItemSelect;

type ItemRow = Prisma.InventoryItemGetPayload<{ select: typeof ITEM_SELECT }>;

/**
 * Arma el plan (lo que se vería en la vista previa) leyendo la base. Con `estimate`, calcula por
 * línea si el stock alcanza (acumulando lo que el propio archivo ya reserva); la aplicación no
 * estima: cada línea la decide `commitInventoryAssignment` bajo lock.
 */
export async function planEventos(
  context: Pick<AdminContext, "organizationId" | "organization">,
  docs: readonly EventoDoc[],
  parseProblems: readonly EventoProblem[],
  options: { estimate: boolean },
): Promise<EventosPlanResult> {
  const { organizationId } = context;
  const problems: EventoProblem[] = [...parseProblems];

  // Productos por SKU de la empresa activa.
  const codes = [...new Set(docs.flatMap((doc) => doc.productos.map((line) => line.codigo)))];
  const items = codes.length ? await db.inventoryItem.findMany({ where: { organizationId, sku: { in: codes } }, select: ITEM_SELECT }) : [];
  const bySku = new Map<string, ItemRow>(items.flatMap((item) => (item.sku ? [[item.sku, item] as const] : [])));
  const definitions = await loadComboDefinitions(organizationId, items.map((item) => item.id));

  // Eventos ya importados: código → evento vivo.
  const keys = docs.map((doc) => doc.codigo.toLowerCase());
  const mappings = keys.length ? await db.idempotencyKey.findMany({ where: { organizationId, scope: IMPORT_EVENTO_SCOPE, key: { in: keys } }, select: { key: true, response: true } }) : [];
  const mappedIds = mappings.flatMap((row) => {
    const id = (row.response as { eventId?: unknown } | null)?.eventId;
    return typeof id === "string" ? [[row.key, id] as const] : [];
  });
  const events = mappedIds.length
    ? await db.event.findMany({ where: { organizationId, id: { in: mappedIds.map(([, id]) => id) } }, select: { id: true, status: true, clientId: true } })
    : [];
  const eventById = new Map(events.map((event) => [event.id, event]));
  const existingByCode = new Map(mappedIds.flatMap(([key, id]) => (eventById.has(id) ? [[key, eventById.get(id)!] as const] : [])));

  // Productos ya reservados en los eventos existentes (para avisar los que el archivo no trae).
  const existingAssignments = events.length
    ? await db.eventInventory.findMany({
        where: { eventId: { in: events.map((event) => event.id) }, releasedAt: null, comboQuantity: 0, event: { organizationId } },
        select: { eventId: true, inventoryId: true, inventory: { select: { name: true, sku: true } } },
      })
    : [];

  const clients: ClientRow[] = await db.client.findMany({ where: { organizationId }, select: { id: true, name: true, company: true, email: true, phone: true }, take: 50_000 });
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));

  const planLimit = docs.length ? await planLimitViolation(context, "events") : null;

  // Estimación de stock (solo vista previa).
  const settings = options.estimate ? await loadRentalSettings(organizationId) : null;
  const wantedIds = new Set<string>();
  const componentRows = new Map<string, ItemRow>();
  let assignments: AssignmentRecord[] = [];
  if (options.estimate) {
    for (const item of items) {
      const definition = definitions.get(item.id);
      if (definition) for (const component of definition.components) wantedIds.add(component.componentId);
      else wantedIds.add(item.id);
    }
    const ids = [...wantedIds];
    if (ids.length) {
      for (const row of await db.inventoryItem.findMany({ where: { organizationId, id: { in: ids } }, select: ITEM_SELECT })) componentRows.set(row.id, row);
      assignments = (await db.eventInventory.findMany({
        where: { inventoryId: { in: ids }, ...committedAssignmentWhere(organizationId) },
        include: { event: { select: EVENT_RANGE_SELECT } },
        take: 20_000,
      })) as AssignmentRecord[];
    }
  }
  const usage: Array<{ inventoryId: string; quantity: number; start: Date | null; end: Date | null }> = [];

  const summary: EventosSummary = { crear: 0, actualizar: 0, omitidos: 0, clientesNuevos: 0, lineasReservadas: 0, lineasSinStock: 0, lineasSinReserva: 0, errores: 0 };
  const out: EventoPlan[] = [];
  let virtualId = 0;

  for (const doc of docs) {
    const existing = existingByCode.get(doc.codigo.toLowerCase()) ?? null;
    const { startsAt, endsAt } = eventoRange(doc.desde, doc.hasta);
    const errors: EventoProblem[] = [];
    const warn = (tipo: EventoProblem["tipo"], mensaje: string) => problems.push(problem("aviso", tipo, doc.codigo, doc.fila, mensaje));
    const fail = (tipo: EventoProblem["tipo"], mensaje: string) => errors.push(problem("error", tipo, doc.codigo, doc.fila, mensaje));
    const cancelled = doc.estado === "cancelado";
    const modo: LineaModo = cancelled ? "liberar" : doc.estado === "confirmado" ? "reservar" : doc.estado === "tentativo" ? "retener" : "sin-reserva";

    if (existing && (existing.status === "IN_PROGRESS" || existing.status === "COMPLETED")) {
      fail("estado", `El evento ya está ${existing.status === "COMPLETED" ? "finalizado" : "en curso"} en LedBox: la importación no lo modifica.`);
    }

    const lineas: LineaPlan[] = doc.productos.map((line) => {
      const item = bySku.get(line.codigo);
      if (!item) {
        if (cancelled) warn("producto", `El producto «${line.codigo}» no existe en el inventario (el evento se cancela igual).`);
        else fail("producto", `El producto «${line.codigo}» no existe en el inventario de esta empresa.`);
        return { codigo: line.codigo, cantidad: line.cantidad, nombre: line.codigo, inventoryId: null, esCombo: false, modo, libres: null, sinStock: false, mensaje: null };
      }
      if (item.comboIncomplete && !cancelled) fail("producto", `«${item.name}» (${line.codigo}) es un juego incompleto (sin piezas cargadas): cargale las piezas antes de reservarlo.`);
      return { codigo: line.codigo, cantidad: line.cantidad, nombre: item.name, inventoryId: item.id, esCombo: definitions.has(item.id), modo, libres: null, sinStock: false, mensaje: null };
    });

    // Cliente: por correo o teléfono; si no existe, se crea (una sola vez aunque aparezca en varios eventos).
    let cliente: EventoPlan["cliente"];
    const matched = matchClient(clients, doc.cliente);
    const currentClientName = existing ? clientNames.get(existing.clientId) : undefined;
    if (matched) {
      cliente = { id: matched.virtual ? null : matched.id, nuevo: Boolean(matched.virtual), nombre: matched.name };
      if (existing && matched.id !== existing.clientId && currentClientName) warn("cliente", `El cliente del evento cambia de «${currentClientName}» a «${matched.name}» (coinciden teléfono o correo del archivo).`);
    } else if (existing && currentClientName && normalizeName(currentClientName) === normalizeName(doc.cliente.nombre)) {
      cliente = { id: existing.clientId, nuevo: false, nombre: currentClientName };
    } else {
      cliente = { id: null, nuevo: true, nombre: doc.cliente.nombre };
    }

    if (!existing && planLimit) fail("plan", planLimit.error);

    // Estimación de stock por línea.
    if (options.estimate && errors.length === 0 && (modo === "reservar" || modo === "retener")) {
      const itemUsage: typeof usage = [];
      for (const linea of lineas) {
        if (!linea.inventoryId) continue;
        const item = bySku.get(linea.codigo)!;
        const parts = definitions.get(item.id)?.components.map((c) => ({ id: c.componentId, per: c.quantity })) ?? [{ id: item.id, per: 1 }];
        let libres = Number.POSITIVE_INFINITY;
        for (const part of parts) {
          const row = componentRows.get(part.id);
          if (!row) {
            libres = 0;
            continue;
          }
          const buffers = resolveRentalBuffers(settings, row);
          const available = buildAvailability(
            { id: row.id, name: row.name, quantity: row.quantity, status: row.status, maintenance: maintenanceUnits(row), buffers },
            assignments.filter((a) => a.inventoryId === row.id && a.event.id !== existing?.id),
            startsAt,
            endsAt,
          ).available;
          const requested = extendedRentalRange(startsAt, endsAt, buffers);
          const used = [...usage, ...itemUsage]
            .filter((u) => u.inventoryId === row.id && overlaps(u.start, u.end, requested.start ?? startsAt, requested.end ?? endsAt))
            .reduce((sum, u) => sum + u.quantity, 0);
          libres = Math.min(libres, Math.floor(Math.max(0, available - used) / part.per));
        }
        linea.libres = Number.isFinite(libres) ? libres : 0;
        if (linea.cantidad > linea.libres) {
          linea.sinStock = true;
          linea.mensaje = sinStockMensaje(linea.nombre, linea.cantidad, linea.libres);
        } else {
          for (const part of parts) {
            const row = componentRows.get(part.id)!;
            const range = extendedRentalRange(startsAt, endsAt, resolveRentalBuffers(settings, row));
            itemUsage.push({ inventoryId: part.id, quantity: part.per * linea.cantidad, start: range.start, end: range.end });
          }
        }
      }
      usage.push(...itemUsage);
    }

    if (errors.length) {
      problems.push(...errors);
      summary.omitidos += 1;
      out.push({ doc, accion: "omitir", existingId: existing?.id ?? null, cliente, lineas, startsAt, endsAt });
      continue;
    }

    if (existing) {
      const fileIds = new Set(lineas.flatMap((line) => (line.inventoryId ? [line.inventoryId] : [])));
      const extra = existingAssignments.filter((row) => row.eventId === existing.id && !fileIds.has(row.inventoryId));
      if (extra.length && !cancelled) warn("producto", `El evento ya tiene ${extra.length} producto${extra.length === 1 ? "" : "s"} reservado${extra.length === 1 ? "" : "s"} que el archivo no trae (${extra.slice(0, 4).map((row) => row.inventory.sku ?? row.inventory.name).join(", ")}${extra.length > 4 ? "…" : ""}): no se tocan.`);
      if (modo === "sin-reserva" && existingAssignments.some((row) => row.eventId === existing.id)) warn("estado", "El evento ya tenía reservas: pasa a borrador pero sus reservas no se tocan (liberalas a mano si ya no corresponden).");
    }
    if (modo === "sin-reserva" && lineas.length) warn("estado", `Como borrador no reserva stock: los ${lineas.length} producto${lineas.length === 1 ? "" : "s"} quedan anotados en las notas del evento.`);
    if (modo === "retener" && lineas.length) warn("estado", "Tentativo: los productos se retienen por el tiempo de retención de la empresa (se pueden confirmar después).");
    for (const linea of lineas) if (linea.sinStock && linea.mensaje) warn("stock", `${linea.mensaje}. Esa línea no se reserva.`);

    if (cliente.nuevo) {
      // Un cliente nuevo que aparece en varios eventos del archivo se cuenta (y se crea) una sola vez.
      if (!matched) {
        summary.clientesNuevos += 1;
        clients.push({ id: `virtual-${(virtualId += 1)}`, name: doc.cliente.nombre, company: null, email: doc.cliente.correo, phone: doc.cliente.telefono, virtual: true });
      }
    }
    if (existing) summary.actualizar += 1;
    else summary.crear += 1;
    for (const linea of lineas) {
      if (modo === "sin-reserva") summary.lineasSinReserva += 1;
      else if (modo === "liberar") continue;
      else if (linea.sinStock) summary.lineasSinStock += 1;
      else summary.lineasReservadas += 1;
    }
    out.push({ doc, accion: existing ? "actualizar" : "crear", existingId: existing?.id ?? null, cliente, lineas, startsAt, endsAt });
  }
  summary.errores = problems.filter((entry) => entry.nivel === "error").length;
  return { items: out, problems, summary };
}

// ── Aplicación ──────────────────────────────────────────────────────────────

export type EventosResult = {
  lote: string;
  creados: Array<{ id: string; etiqueta: string }>;
  actualizados: number;
  juegos: number;
  fotos: number;
  omitidos: number;
  fallidos: Array<{ codigo: string; mensaje: string }>;
  avisos: Array<{ codigo: string; mensaje: string }>;
  tarjetas: Array<{ etiqueta: string; valor: number }>;
  summary: { clientesNuevos: number; lineasReservadas: number; lineasSinStock: number; lineasLiberadas: number };
};

class PlanLimitError extends Error {}
class EventImportConflict extends Error {}

const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function applyEventos(
  context: AdminContext,
  input: { eventos: readonly EventoDoc[]; lote: string; onProgress?: (progress: { hecho: number; total: number; fase: string }) => void },
): Promise<EventosResult> {
  const { organizationId } = context;
  const plan = await planEventos(context, input.eventos, [], { estimate: false });
  const creados: EventosResult["creados"] = [];
  const clientesCreados: Array<{ id: string; etiqueta: string }> = [];
  const fallidos: EventosResult["fallidos"] = plan.problems.filter((entry) => entry.nivel === "error").map((entry) => ({ codigo: entry.codigo ?? "Archivo", mensaje: entry.mensaje }));
  const avisos: EventosResult["avisos"] = plan.problems.filter((entry) => entry.nivel === "aviso").map((entry) => ({ codigo: entry.codigo ?? "General", mensaje: entry.mensaje }));
  let aplicadosFallidos = 0;
  let actualizados = 0;
  let reservadas = 0;
  let sinStock = 0;
  let liberadas = 0;

  let done = 0;
  for (const item of plan.items) {
    input.onProgress?.({ hecho: done, total: plan.items.length, fase: "Cargando eventos" });
    done += 1;
    if (item.accion === "omitir") continue;
    const { doc } = item;
    const notice = (mensaje: string) => avisos.push({ codigo: doc.codigo, mensaje });
    try {
      const status = STATUS_OF[doc.estado];
      const modo: LineaModo = doc.estado === "cancelado" ? "liberar" : doc.estado === "confirmado" ? "reservar" : doc.estado === "tentativo" ? "retener" : "sin-reserva";
      const productNames = item.lineas.map((line) => `${line.nombre} ×${line.cantidad}`);
      const key = doc.codigo.toLowerCase();

      const written = await db.$transaction(
        async (tx) => {
          // El código todavía puede no tener fila: el lock lógico cubre también el alta.
          await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${IMPORT_EVENTO_SCOPE}:${key}`}, 0))`);
          const mapping = await tx.idempotencyKey.findUnique({ where: { organizationId_scope_key: { organizationId, scope: IMPORT_EVENTO_SCOPE, key } }, select: { response: true } });
          const mappedId = (mapping?.response as { eventId?: unknown } | null)?.eventId;

          let eventId = typeof mappedId === "string" ? mappedId : null;
          let existingNotes: string | null = null;
          if (eventId) {
            // Candado del evento: dos importaciones del mismo código se serializan.
            const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} AND "organizationId" = ${organizationId} AND "deletedAt" IS NULL FOR UPDATE`);
            if (locked.length === 0) eventId = null;
          }
          let created = false;
          if (eventId) {
            const current = await tx.event.findFirst({ where: { id: eventId, organizationId }, select: { notes: true, status: true, startsAt: true, endsAt: true } });
            if (!current || current.status === "IN_PROGRESS" || current.status === "COMPLETED") throw new Error("El evento cambió mientras se importaba: volvé a generar la vista previa.");
            // Las reservas heredadas usan las fechas/estado del evento: cambiarlos primero
            // desplazaría stock sin pasar por disponibilidad. La reprogramación se hace en Eventos.
            const rangeChanged = current.startsAt?.getTime() !== item.startsAt.getTime() || current.endsAt?.getTime() !== item.endsAt.getTime();
            const reactivating = current.status === "CANCELLED" && status !== "CANCELLED";
            if (status !== "CANCELLED" && (rangeChanged || reactivating)) {
              const active = await tx.eventInventory.count({ where: { eventId, releasedAt: null, event: { organizationId } } });
              if (active > 0) throw new EventImportConflict("Este evento tiene reservas: reprogramalo o liberá sus reservas desde Eventos antes de cambiar sus fechas o reactivarlo por importación.");
            }
            existingNotes = current.notes;
          } else {
            const limit = await lockedEventLimitViolation(tx, context);
            if (limit) throw new PlanLimitError(limit.error);
            eventId = randomUUID();
            created = true;
          }
          // Cliente: el de la vista previa o, si ya apareció en este lote, el creado hace un instante.
          const currentClients: ClientRow[] = await tx.client.findMany({ where: { organizationId }, select: { id: true, name: true, company: true, email: true, phone: true }, take: 50_000 });
          const matched = matchClient(currentClients, doc.cliente);
          let clientId = matched?.id ?? null;
          let clientCreated = false;
          if (!clientId) {
            clientId = randomUUID();
            await tx.client.create({
              data: { id: clientId, organizationId, name: doc.cliente.nombre, phone: doc.cliente.telefono, email: doc.cliente.correo, type: "FINAL" },
            });
            await recordAudit({ context, action: "create", entity: "Client", entityId: clientId, summary: `Creó el cliente «${doc.cliente.nombre}» (importación de eventos)`, detail: { fields: { name: doc.cliente.nombre, phone: doc.cliente.telefono, email: doc.cliente.correo } } }, tx);
            clientCreated = true;
          }

          const notes = composeNotes(doc.notas ?? stripBlock(existingNotes), modo === "sin-reserva" && productNames.length ? [`Productos pedidos (sin reservar): ${productNames.join(", ")}`] : []);
          const data = { clientId, name: doc.nombre, location: doc.lugar, startsAt: item.startsAt, endsAt: item.endsAt, status, notes };
          if (created) {
            await tx.event.create({
              data: {
                id: eventId,
                organizationId,
                ...data,
                tasks: {
                  create: [
                    { id: randomUUID(), type: "SETUP", title: "Confirmar montaje y acceso al lugar" },
                    { id: randomUUID(), type: "EVENT", title: "Verificar equipos y operación del evento" },
                    { id: randomUUID(), type: "STRIKE", title: "Coordinar desmontaje y devolución" },
                    { id: randomUUID(), type: "COLLECTION", title: "Confirmar cobro / saldo" },
                  ],
                },
              },
            });
          } else {
            await tx.event.update({ where: { id: eventId }, data });
          }
          // Vínculo código → evento (si el evento anterior ya no existe, se reemplaza).
          await tx.idempotencyKey.upsert({
            where: { organizationId_scope_key: { organizationId, scope: IMPORT_EVENTO_SCOPE, key } },
            create: { id: randomUUID(), organizationId, scope: IMPORT_EVENTO_SCOPE, key, requestHash: doc.codigo, status: 200, response: { eventId, codigo: doc.codigo }, expiresAt: FOREVER },
            update: { requestHash: doc.codigo, status: 200, response: { eventId, codigo: doc.codigo }, expiresAt: FOREVER },
          });
          await recordAudit(
            { context, action: created ? "create" : "update", entity: "Event", entityId: eventId, summary: `${created ? "Creó" : "Actualizó"} el evento «${doc.nombre}» (importación, código ${doc.codigo})`, detail: { fields: { codigo: doc.codigo, estado: doc.estado, desde: doc.desde, hasta: doc.hasta, lote: input.lote } } },
            tx,
          );
          return { eventId, created, clientId, clientCreated, existingNotes };
        },
        { timeout: 20_000 },
      );
      if (written.clientCreated) {
        clientesCreados.push({ id: written.clientId, etiqueta: doc.cliente.nombre });
      }
      if (written.created) creados.push({ id: written.eventId, etiqueta: `${doc.codigo} · ${doc.nombre}` });
      else actualizados += 1;

      // Líneas: cada una pasa por el motor de disponibilidad bajo lock (nunca se sobrevende).
      const sinStockLines: string[] = [];
      const lineNotes: string[] = [];
      if (modo === "reservar" || modo === "retener") {
        for (const linea of item.lineas) {
          if (!linea.inventoryId) continue;
          // La cantidad de la fila de un componente incluye lo que aportan los juegos del mismo evento:
          // la línea suelta del archivo se suma a eso para no pisar la parte del juego.
          const current = await db.eventInventory.findUnique({ where: { eventId_inventoryId: { eventId: written.eventId, inventoryId: linea.inventoryId } }, select: { comboQuantity: true, releasedAt: true, holdExpiresAt: true } });
          const fromCombos = current && !current.releasedAt && (!current.holdExpiresAt || current.holdExpiresAt > new Date()) ? current.comboQuantity : 0;
          const result = await commitInventoryAssignment({
            organizationId,
            eventId: written.eventId,
            inventoryId: linea.inventoryId,
            quantity: linea.cantidad + fromCombos,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            hold: modo === "retener",
          });
          if (result.ok) {
            reservadas += 1;
            continue;
          }
          if (result.reason === "insufficient") {
            const message = sinStockMensaje(linea.nombre, linea.cantidad, Math.max(0, result.availability.available - fromCombos));
            sinStockLines.push(message);
            sinStock += 1;
            notice(`${message}. Esa línea no se reservó.`);
          } else if (result.reason === "blocked") {
            const message = `${linea.nombre}: está ${result.item.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}`;
            sinStockLines.push(message);
            sinStock += 1;
            notice(`${message}. Esa línea no se reservó.`);
          } else if (result.reason === "conflict") {
            lineNotes.push(`${linea.nombre}: ${result.message}`);
            sinStock += 1;
            notice(`${linea.nombre}: ${result.message}`);
          } else {
            throw new Error(`No se pudo reservar «${linea.nombre}»: ${result.reason === "event-missing" ? "el evento ya no existe" : "el producto ya no existe"}.`);
          }
        }
      } else if (modo === "liberar") {
        const rows = await db.eventInventory.findMany({ where: { eventId: written.eventId, releasedAt: null, event: { organizationId } }, select: { id: true, inventoryId: true, inventory: { select: { name: true } } } });
        const combos = await loadComboDefinitions(organizationId, rows.map((row) => row.inventoryId));
        for (const row of [...rows].sort((a, b) => Number(combos.has(b.inventoryId)) - Number(combos.has(a.inventoryId)))) {
          const released = await releaseAssignment({ organizationId, assignmentId: row.id });
          if (released.ok) liberadas += released.unchanged ? 0 : 1;
          else if (released.reason === "in-movement") notice(`${row.inventory.name}: ya salió del depósito y sigue contando hasta su devolución.`);
        }
      }
      if (sinStockLines.length || lineNotes.length) {
        const base = doc.notas ?? stripBlock(written.existingNotes);
        const block = [...sinStockLines.map((line) => `Sin stock al importar: ${line}.`), ...lineNotes.map((line) => `No se reservó: ${line}`)];
        await db.event.updateMany({ where: { id: written.eventId, organizationId }, data: { notes: composeNotes(base, block) } });
      }
    } catch (error) {
      if (!(error instanceof PlanLimitError)) console.error("[import-eventos] Falló un evento:", doc.codigo, error instanceof Error ? error.message : error);
      aplicadosFallidos += 1;
      fallidos.push({
        codigo: doc.codigo,
        mensaje: (error instanceof PlanLimitError || error instanceof EventImportConflict) ? error.message : isUnique(error) ? "Otra importación creó este evento al mismo tiempo: volvé a intentar." : error instanceof Error && /cambió mientras|No se pudo reservar/.test(error.message) ? error.message : "No pudimos guardar este evento. Reintentá: reimportar no duplica.",
      });
    }
  }

  const omitidos = plan.summary.omitidos + aplicadosFallidos;
  const result: EventosResult = {
    lote: input.lote,
    creados,
    actualizados,
    juegos: 0,
    fotos: 0,
    omitidos,
    fallidos,
    avisos,
    tarjetas: [
      { etiqueta: "Eventos creados", valor: creados.length },
      { etiqueta: "Eventos actualizados", valor: actualizados },
      { etiqueta: "Clientes nuevos", valor: clientesCreados.length },
      { etiqueta: "Líneas reservadas", valor: reservadas },
      { etiqueta: "Líneas sin stock", valor: sinStock },
      { etiqueta: "Omitidos", valor: omitidos },
    ],
    summary: { clientesNuevos: clientesCreados.length, lineasReservadas: reservadas, lineasSinStock: sinStock, lineasLiberadas: liberadas },
  };
  await recordAudit({
    context,
    action: "create",
    entity: "IaCarga",
    entityId: input.lote,
    summary: `Importó eventos (${creados.length} nuevos, ${actualizados} actualizados, ${clientesCreados.length} clientes nuevos, ${reservadas} líneas reservadas, ${sinStock} sin stock)`,
    detail: {
      fields: {
        lote: input.lote,
        origen: "importar-eventos",
        eventos: creados.map((row) => row.id),
        clientes: clientesCreados.map((row) => row.id),
        actualizados,
        lineasReservadas: reservadas,
        lineasSinStock: sinStock,
        lineasLiberadas: liberadas,
        omitidos,
        fallidos: fallidos.length,
      },
    },
  });
  return result;
}
