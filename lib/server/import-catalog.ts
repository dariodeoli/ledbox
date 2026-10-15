/**
 * «Importar catálogo»: vista previa y aplicación contra la base.
 *
 * Reutiliza el alta de inventario existente: mismas reglas de campo
 * (`lib/field-rules.ts` vía `lib/import-catalog.ts`), mismas unidades
 * (`createInventoryUnits`) y mismos combos (`saveCombo`, con sus guardas de
 * anidación y reservas). Nada crea un inventario paralelo. Todo va acotado por
 * la empresa activa; las fotos usan `imageData`/`imageMime`.
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, dbWithDeleted } from "@/lib/server/db";
import { auditChanges, recordAudit, type AuditContext } from "@/lib/server/audit";
import { beginInventoryUnitIncidentCycle, createInventoryUnits, isUniqueConstraintError, syncInventoryQuantity } from "@/lib/server/inventory-units";
import { saveCombo } from "@/lib/server/inventory-combos";
import { categoryWriteData, resolveInventoryCategory } from "@/lib/server/inventory-categories";
import { findWarehouseByCode } from "@/lib/server/inventory-warehouses";
import { assignmentCountsAt, assignmentRange, committedAssignmentWhere, EVENT_RANGE_SELECT, lockInventoryItems } from "@/lib/server/inventory-availability";
import { replaceAudienceTiers } from "@/lib/server/price-tier-store";
import { addItemsToCollection, COLLECTION_PHOTO_WIDTH, upsertCollectionByName } from "@/lib/server/collections";
import { prepareImage } from "@/lib/server/covers";
import { collectionSlug } from "@/lib/collections";
import { prepareCategoryPhoto, setCategoryImage } from "@/lib/server/category-image";
import { preparePhoto, type PreparedPhoto } from "@/lib/server/import-photos";
import {
  ADJUSTABLE_STATES,
  codesToLookUp,
  planCatalog,
  planUnitStates,
  stateTargetsOf,
  type AdjustableState,
  type UnitStateCounts,
  type CatalogCategory,
  type CatalogCollection,
  type CatalogPlan,
  type CatalogProduct,
  type ExistingItem,
  type ImportProblem,
  type PlannedProduct,
  catalogSpecs,
} from "@/lib/import-catalog";

const BLOCK_SIZE = 25;

/** `cobro` del catálogo → `InventoryItem.billingUnit` (docs/ALQUILERES-OPERACION.md P1-1). */
const billingUnitOf = (cobro: "evento" | "dia") => (cobro === "evento" ? ("EVENT" as const) : ("DAILY" as const));

/**
 * Cantidad comprometida por producto: asignaciones que comprometen stock (mismas reglas que la
 * disponibilidad), sin devolver y vigentes o futuras. Las unidades no se fijan a un evento, así que
 * esta cantidad es la reserva que no se puede sacar de AVAILABLE.
 */
async function committedQuantities(client: Pick<typeof db, "eventInventory">, organizationId: string, inventoryIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (inventoryIds.length === 0) return result;
  const now = new Date();
  const rows = await client.eventInventory.findMany({
    where: { inventoryId: { in: inventoryIds }, ...committedAssignmentWhere(organizationId, now) },
    select: { inventoryId: true, quantity: true, startsAt: true, endsAt: true, checkedOut: true, checkedIn: true, checkedInAt: true, releasedAt: true, holdExpiresAt: true, event: { select: EVENT_RANGE_SELECT } },
  });
  for (const row of rows) {
    if (row.checkedIn || row.checkedInAt || !assignmentCountsAt(row, now)) continue;
    const { end } = assignmentRange(row);
    const outstanding = row.checkedOut;
    if (!outstanding && end && end.getTime() < now.getTime()) continue;
    result.set(row.inventoryId, (result.get(row.inventoryId) ?? 0) + row.quantity);
  }
  return result;
}

const INCIDENT_KIND_OF = { MAINTENANCE: "REPAIR", DAMAGED: "DAMAGE", LOST: "MISSING" } as const;
const STATE_LABEL = { AVAILABLE: "disponible", MAINTENANCE: "mantenimiento", DAMAGED: "dañada", LOST: "perdida" } as const;
const IMPORT_NOTE = "Importación";

/**
 * Lleva las unidades al estado del archivo dentro de la transacción del producto (con el candado del
 * ítem ya tomado). Mismo rastro que el cambio manual de la ficha: auditoría de la unidad y cantidad
 * sincronizada; además un incidente abierto («Importación») al salir de servicio, que se resuelve
 * cuando la unidad vuelve a estar disponible. Nunca toca unidades RETIRED.
 */
async function applyUnitStates(tx: Tx, context: AuditContext, inventoryId: string, itemName: string, targets: ReturnType<typeof stateTargetsOf>) {
  const units = await tx.inventoryUnit.findMany({ where: { organizationId: context.organizationId, inventoryId, status: { in: ["AVAILABLE", ...ADJUSTABLE_STATES] } }, orderBy: { code: "asc" }, select: { id: true, code: true, status: true } });
  const counts: UnitStateCounts = { AVAILABLE: 0, MAINTENANCE: 0, DAMAGED: 0, LOST: 0 };
  for (const unit of units) counts[unit.status as keyof UnitStateCounts] += 1;
  const committed = (await committedQuantities(tx, context.organizationId, [inventoryId])).get(inventoryId) ?? 0;
  const plan = planUnitStates({ counts, nuevas: 0, comprometidas: committed, targets });
  const change = async (unit: { id: string; code: string; status: string }, to: "AVAILABLE" | AdjustableState) => {
    const before = { status: unit.status };
    if (to === "AVAILABLE") {
      await tx.inventoryIncident.updateMany({
        where: { organizationId: context.organizationId, unitId: unit.id, status: { in: ["OPEN", "IN_REPAIR"] } },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: context.user.id },
      });
      await tx.inventoryUnit.update({ where: { id: unit.id }, data: { status: to, incidentCycle: { increment: 1 } } });
    } else {
      const unitCycle = await beginInventoryUnitIncidentCycle(tx, context.organizationId, unit.id);
      await tx.inventoryUnit.update({ where: { id: unit.id }, data: { status: to } });
      await tx.inventoryIncident.create({
        data: { id: randomUUID(), organizationId: context.organizationId, inventoryId, unitId: unit.id, unitCycle, kind: INCIDENT_KIND_OF[to], quantity: 1, status: "OPEN", notes: IMPORT_NOTE, openedById: context.user.id },
      });
    }
    const changes = auditChanges(before, { status: to }, ["status"]);
    if (changes) {
      await recordAudit(
        { context, action: "update", entity: "InventoryUnit", entityId: unit.id, summary: `Importación: la unidad «${unit.code}» de «${itemName}» pasó a ${STATE_LABEL[to]}`, detail: { changes } },
        tx,
      );
    }
  };
  // Primero vuelven a disponible, después salen de servicio (las últimas por código).
  const returned = new Set<string>();
  for (const state of ADJUSTABLE_STATES) {
    for (const unit of units.filter((row) => row.status === state).slice(0, plan.aDisponible[state])) {
      await change(unit, "AVAILABLE");
      returned.add(unit.id);
    }
  }
  const pool = units.filter((row) => row.status === "AVAILABLE" || returned.has(row.id)).reverse();
  for (const state of ADJUSTABLE_STATES) {
    for (let i = 0; i < plan.aEstado[state]; i += 1) {
      const unit = pool.shift();
      if (unit) await change(unit, state);
    }
  }
  await syncInventoryQuantity(tx, inventoryId);
}

/** Lo que hay en la empresa para esos códigos (incluye la papelera). */
export async function loadExisting(organizationId: string, codes: string[]): Promise<Map<string, ExistingItem>> {
  const rows = codes.length
    ? await dbWithDeleted.inventoryItem.findMany({
        where: { organizationId, sku: { in: codes } },
        select: { id: true, sku: true, name: true, deletedAt: true, comboIncomplete: true, _count: { select: { components: true, units: true, assignments: true } } },
      })
    : [];
  // Unidades con historial (fuera de servicio, retiradas, perdidas o con incidentes): decide si una unidad se puede convertir en juego.
  const history = rows.length
    ? await dbWithDeleted.inventoryUnit.groupBy({
        by: ["inventoryId"],
        where: { organizationId, inventoryId: { in: rows.map((row) => row.id) }, OR: [{ status: { not: "AVAILABLE" } }, { incidents: { some: {} } }] },
        _count: { _all: true },
      })
    : [];
  const historyById = new Map(history.map((row) => [row.inventoryId, row._count._all]));
  const ids = rows.map((row) => row.id);
  const byStatus = ids.length ? await dbWithDeleted.inventoryUnit.groupBy({ by: ["inventoryId", "status"], where: { organizationId, inventoryId: { in: ids } }, _count: { _all: true } }) : [];
  const statesById = new Map<string, UnitStateCounts>();
  for (const row of byStatus) {
    if (row.status === "RETIRED") continue;
    const counts = statesById.get(row.inventoryId) ?? { AVAILABLE: 0, MAINTENANCE: 0, DAMAGED: 0, LOST: 0 };
    counts[row.status] = row._count._all;
    statesById.set(row.inventoryId, counts);
  }
  const committedById = await committedQuantities(dbWithDeleted, organizationId, ids);
  return new Map(
    rows.flatMap((row) =>
      row.sku
        ? [
            [
              row.sku,
              {
                id: row.id,
                name: row.name,
                isCombo: row._count.components > 0,
                inTrash: row.deletedAt !== null,
                units: row._count.units,
                incompleto: row.comboIncomplete,
                reservas: row._count.assignments,
                unidadesConHistorial: historyById.get(row.id) ?? 0,
                estados: statesById.get(row.id) ?? { AVAILABLE: 0, MAINTENANCE: 0, DAMAGED: 0, LOST: 0 },
                comprometidas: committedById.get(row.id) ?? 0,
              } satisfies ExistingItem,
            ] as const,
          ]
        : [],
    ),
  );
}

export type ImportInput = {
  products: CatalogProduct[];
  parseProblems: ImportProblem[];
  /** Fotos del ZIP por clave; `null` si no se subió ZIP. */
  photos: Map<string, Uint8Array> | null;
  photoProblems: ImportProblem[];
  /** Sección opcional `categorias` del archivo (foto propia y orden); ausente = ninguna. */
  categories?: CatalogCategory[];
  /** Sección opcional `colecciones` del archivo (descripción, foto y orden); ausente = solo las que nombran los productos. */
  collections?: CatalogCollection[];
};

/** Vista previa: no escribe nada. */
export async function previewCatalog(organizationId: string, input: ImportInput): Promise<CatalogPlan> {
  const existing = await loadExisting(organizationId, codesToLookUp(input.products));
  const warehouses = await db.warehouse.findMany({ where: { organizationId, archivedAt: null }, select: { code: true } });
  return planCatalog({
    warehouseCodes: new Set(warehouses.map((warehouse) => warehouse.code)),
    products: input.products,
    parseProblems: input.parseProblems,
    existing,
    photoNames: input.photos ? new Set(input.photos.keys()) : null,
    photoProblems: input.photoProblems,
    categories: input.categories ?? [],
    collections: input.collections ?? [],
  });
}

export type ApplyFailure = { codigo: string; mensaje: string };

export type ApplyResult = {
  lote: string;
  creados: Array<{ id: string; etiqueta: string }>;
  actualizados: number;
  juegos: number;
  fotos: number;
  /** Fotos de categoría guardadas. */
  fotosCategoria: number;
  /** Fotos extra de producto guardadas, colecciones tocadas (creadas o actualizadas) y fotos de colección guardadas. */
  fotosExtra: number;
  colecciones: number;
  fotosColeccion: number;
  omitidos: number;
  fallidos: ApplyFailure[];
  summary: CatalogPlan["summary"];
  problems: ImportProblem[];
};

type Tx = Prisma.TransactionClient;
type Outcome = { id: string; created: boolean; photo: boolean };

/** Alcance del producto: visible en la web (RETAIL) salvo que el dueño ya lo haya abierto a otro público. */
const visibilityData = (current: { catalogAudience: string | null; visibleOnWeb: boolean } | null) =>
  current && current.visibleOnWeb && current.catalogAudience && current.catalogAudience !== "HIDDEN" ? {} : { catalogAudience: "RETAIL", visibleOnWeb: true };

function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array): boolean {
  return Boolean(a) && a!.byteLength === b.byteLength && Buffer.compare(Buffer.from(a!), Buffer.from(b)) === 0;
}

/** Capacidad y medidas del archivo en los campos de la ficha; lo que el archivo no trae no se pisa. */
const specData = (product: Parameters<typeof catalogSpecs>[0]) => {
  const { capacity, dimensions } = catalogSpecs(product);
  return { ...(capacity !== null ? { capacity } : {}), ...(dimensions ? { dimensions } : {}) };
};

/** Escribe el alta o la actualización de un producto-unidad dentro de una transacción. */
async function writeUnitItem(tx: Tx, context: AuditContext, planned: PlannedProduct, photo: PreparedPhoto | null): Promise<Outcome> {
  const { organizationId } = context;
  const { product } = planned;
  // Categoría y subcategoría: se crean o se asocian con el helper único (sin duplicar padre ni hija).
  const category = await resolveInventoryCategory(tx, organizationId, { category: product.categoria, subcategory: product.subcategoria });
  if (!category) throw new Error("No se pudo resolver la categoría.");
  const warehouse = product.deposito ? await findWarehouseByCode(tx, organizationId, product.deposito) : null;
  const baseData = {
    name: product.nombre,
    ...categoryWriteData(category),
    publicDescription: planned.publicDescription,
    ...specData(product),
    billingUnit: billingUnitOf(product.cobro),
    ...(product.precio ? { listPrice: product.precio } : {}),
    // Estilos para filtrar: ausente = no se toca; una lista (aun vacía) reemplaza.
    ...(Array.isArray(product.estilo) ? { tags: product.estilo } : {}),
  };
  if (planned.existingId) {
    const locked = await lockInventoryItems(tx, organizationId, [planned.existingId]);
    if (!locked.has(planned.existingId)) throw new Error("El producto ya no existe en esta empresa.");
    const current = await tx.inventoryItem.findFirst({
      where: { id: planned.existingId, organizationId },
      select: { catalogAudience: true, visibleOnWeb: true, imageData: true, quantity: true, comboIncomplete: true, _count: { select: { components: true } } },
    });
    if (!current) throw new Error("El producto ya no existe en esta empresa.");
    if (current._count.components > 0 || current.comboIncomplete) throw new Error("Ahora es un juego en el inventario; no se cambia el tipo por importación.");
    const photoChanged = Boolean(photo) && !sameBytes(current.imageData, photo!.data);
    await tx.inventoryItem.update({
      where: { id: planned.existingId },
      data: { ...baseData, ...visibilityData(current), ...(photoChanged ? { imageData: photo!.data, imageMime: photo!.mime } : {}) },
    });
    // Nunca se retiran unidades: solo se completan hasta la cantidad del archivo.
    if (product.cantidad !== null && current.quantity < product.cantidad) {
      await createInventoryUnits(tx, {
        organizationId,
        inventoryId: planned.existingId,
        name: product.nombre,
        quantity: product.cantidad - current.quantity,
        ...(warehouse ? { warehouseId: warehouse.id } : {}),
        ...(product.ubicacion ? { location: product.ubicacion } : {}),
      });
    }
    if (product.preciosDias?.length) await replaceAudienceTiers(tx, organizationId, planned.existingId, "RETAIL", product.preciosDias);
    const targets = stateTargetsOf(product);
    if (Object.keys(targets).length > 0) await applyUnitStates(tx, context, planned.existingId, product.nombre, targets);
    return { id: planned.existingId, created: false, photo: photoChanged };
  }
  const id = randomUUID();
  await tx.inventoryItem.create({
    data: {
      id,
      organizationId,
      sku: product.codigo,
      kind: "REUSABLE",
      quantity: planned.unidades,
      ...baseData,
      listPrice: product.precio ?? 0,
      ...visibilityData(null),
      ...(photo ? { imageData: photo.data, imageMime: photo.mime } : {}),
    },
  });
  await createInventoryUnits(tx, {
    organizationId,
    inventoryId: id,
    name: product.nombre,
    quantity: planned.unidades,
    ...(warehouse ? { warehouseId: warehouse.id } : {}),
    ...(product.ubicacion ? { location: product.ubicacion } : {}),
  });
  if (product.preciosDias?.length) await replaceAudienceTiers(tx, organizationId, id, "RETAIL", product.preciosDias);
  const targets = stateTargetsOf(product);
  if (Object.keys(targets).length > 0) await applyUnitStates(tx, context, id, product.nombre, targets);
  return { id, created: true, photo: Boolean(photo) };
}

/** Alta de un juego sin piezas: combo incompleto, sin stock propio ni unidades. Los datos finos los completa `writeComboMeta`. */
async function createIncompleteGame(tx: Tx, organizationId: string, planned: PlannedProduct): Promise<string> {
  const { product } = planned;
  const category = await resolveInventoryCategory(tx, organizationId, { category: product.categoria, subcategory: product.subcategoria });
  if (!category) throw new Error("No se pudo resolver la categoría.");
  const id = randomUUID();
  await tx.inventoryItem.create({
    data: { id, organizationId, sku: product.codigo, name: product.nombre, ...categoryWriteData(category), kind: "REUSABLE", quantity: 0, comboIncomplete: true, listPrice: product.precio ?? 0 },
  });
  return id;
}

/** Actualiza los datos propios de un combo (nombre, precio, descripción, visibilidad, foto). */
async function writeComboMeta(tx: Tx, organizationId: string, id: string, planned: PlannedProduct, photo: PreparedPhoto | null): Promise<boolean> {
  const { product } = planned;
  const current = await tx.inventoryItem.findFirst({ where: { id, organizationId }, select: { catalogAudience: true, visibleOnWeb: true, imageData: true } });
  if (!current) throw new Error("El juego ya no existe en esta empresa.");
  const photoChanged = Boolean(photo) && !sameBytes(current.imageData, photo!.data);
  const category = await resolveInventoryCategory(tx, organizationId, { category: product.categoria, subcategory: product.subcategoria });
  if (!category) throw new Error("No se pudo resolver la categoría.");
  await tx.inventoryItem.update({
    where: { id },
    data: {
      name: product.nombre,
      ...categoryWriteData(category),
      publicDescription: planned.publicDescription,
      ...specData(product),
      billingUnit: billingUnitOf(product.cobro),
      ...(product.precio ? { listPrice: product.precio } : {}),
      ...(Array.isArray(product.estilo) ? { tags: product.estilo } : {}),
      ...visibilityData(current),
      ...(photoChanged ? { imageData: photo!.data, imageMime: photo!.mime } : {}),
    },
  });
  if (product.preciosDias?.length) await replaceAudienceTiers(tx, organizationId, id, "RETAIL", product.preciosDias);
  return photoChanged;
}

async function photoFor(planned: PlannedProduct, photos: Map<string, Uint8Array> | null, failures: ApplyFailure[]): Promise<PreparedPhoto | null> {
  if (!planned.foto || !photos) return null;
  const bytes = photos.get(planned.foto);
  if (!bytes) return null;
  const prepared = await preparePhoto(bytes);
  if (!prepared) failures.push({ codigo: planned.product.codigo, mensaje: `La foto «${planned.foto}» no se pudo procesar; el producto se importó sin foto.` });
  return prepared;
}

/**
 * Fotos extra de un producto: el archivo manda (reemplaza la lista). Idempotente: si las fotos del ZIP son las mismas que
 * ya tiene, en el mismo orden, no escribe nada. Una transacción con el candado del producto; siempre de ESTA empresa.
 */
async function writeExtraPhotos(organizationId: string, itemId: string, photos: PreparedPhoto[]): Promise<boolean> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${itemId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const current = await tx.inventoryImage.findMany({ where: { organizationId, itemId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { data: true } });
      if (current.length === photos.length && current.every((row, index) => sameBytes(row.data, photos[index].data))) return false;
      await tx.inventoryImage.deleteMany({ where: { organizationId, itemId } });
      for (let index = 0; index < photos.length; index += 1) {
        await tx.inventoryImage.create({ data: { id: randomUUID(), organizationId, itemId, position: index + 1, mime: photos[index].mime, size: photos[index].data.byteLength, data: photos[index].data } });
      }
      return true;
    },
    { timeout: 30_000 },
  );
}

export type ApplyProgress = { hecho: number; total: number; fase: string };

export async function applyCatalog(context: AuditContext, input: ImportInput & { lote: string; onProgress?: (progress: ApplyProgress) => void }): Promise<ApplyResult> {
  const { organizationId } = context;
  const plan = await previewCatalog(organizationId, input);
  const failures: ApplyFailure[] = [];
  const failedProducts = new Set<string>();
  const created: ApplyResult["creados"] = [];
  const idByCode = new Map<string, string>();
  const planned = plan.items.filter((item) => item.accion !== "omitir");
  let updated = 0;
  let photosSaved = 0;
  let combosDone = 0;

  const total = planned.length;
  let hecho = 0;
  const advance = (count: number, fase: string) => {
    hecho += count;
    input.onProgress?.({ hecho: Math.min(hecho, total), total, fase });
  };
  // Fichas que comparten foto: se procesa una vez y cada producto guarda su copia.
  const prepared = new Map<string, Promise<PreparedPhoto | null>>();
  const photoOf = (item: PlannedProduct): Promise<PreparedPhoto | null> => {
    if (!item.foto || !input.photos) return Promise.resolve(null);
    let promise = prepared.get(item.foto);
    if (!promise) {
      promise = photoFor(item, input.photos, failures);
      prepared.set(item.foto, promise);
    }
    return promise;
  };

  const label = (item: PlannedProduct) => `${item.product.codigo} · ${item.product.nombre}`;
  const note = (outcome: Outcome, item: PlannedProduct) => {
    idByCode.set(item.product.codigo, outcome.id);
    if (outcome.created) created.push({ id: outcome.id, etiqueta: label(item) });
    else updated += 1;
    if (outcome.photo) photosSaved += 1;
  };

  // Fase 1: productos-unidad, en bloques. Las fotos se procesan fuera de la transacción.
  const units = planned.filter((item) => !item.esCombo);
  for (let start = 0; start < units.length; start += BLOCK_SIZE) {
    const block = units.slice(start, start + BLOCK_SIZE);
    const blockPhotos = new Map<string, PreparedPhoto | null>();
    // Hasta 4 fotos a la vez: rápido sin disparar la memoria.
    for (let i = 0; i < block.length; i += 4) {
      await Promise.all(block.slice(i, i + 4).map(async (item) => blockPhotos.set(item.product.codigo, await photoOf(item))));
    }
    try {
      const outcomes = await db.$transaction(
        async (tx) => {
          const list: Array<[PlannedProduct, Outcome]> = [];
          for (const item of block) list.push([item, await writeUnitItem(tx, context, item, blockPhotos.get(item.product.codigo) ?? null)]);
          return list;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      for (const [item, outcome] of outcomes) note(outcome, item);
    } catch (blockError) {
      console.error("[import-catalogo] Bloque revertido, se reintenta producto por producto:", blockError instanceof Error ? blockError.message : blockError);
      for (const item of block) {
        try {
          const outcome = await db.$transaction((tx) => writeUnitItem(tx, context, item, blockPhotos.get(item.product.codigo) ?? null), { timeout: 30_000 });
          note(outcome, item);
        } catch (error) {
          const message = isUniqueConstraintError(error) ? `Ya existe un producto con el código ${item.product.codigo}.` : error instanceof Error ? error.message : "No se pudo importar.";
          console.error(`[import-catalogo] ${item.product.codigo}:`, error instanceof Error ? error.message : error);
          failures.push({ codigo: item.product.codigo, mensaje: message });
          failedProducts.add(item.product.codigo);
        }
      }
    }
    advance(block.length, "Productos");
  }

  // Fase 2: juegos (combos) con el motor de combos; necesitan los ids de sus componentes.
  const combos = planned.filter((item) => item.esCombo);
  if (combos.length > 0) {
    const stored = await loadExisting(organizationId, codesToLookUp(combos.map((item) => item.product)));
    for (const [code, item] of stored) if (!idByCode.has(code)) idByCode.set(code, item.id);
    const existingIds = combos.flatMap((item) => (item.existingId ? [item.existingId] : []));
    const currentComponents = existingIds.length
      ? await db.inventoryComponent.findMany({ where: { organizationId, parentId: { in: existingIds } }, select: { parentId: true, componentId: true, quantity: true } })
      : [];
    for (const item of combos) {
      const code = item.product.codigo;
      try {
        let comboId = item.existingId;
        let isNew = false;
        if (item.product.componentes.length === 0) {
          // Juego sin piezas en el archivo: nuevo = juego incompleto; existente = solo se actualizan sus datos.
          if (!item.existingId) {
            comboId = await db.$transaction((tx) => createIncompleteGame(tx, organizationId, item), { timeout: 30_000 });
            isNew = true;
            idByCode.set(code, comboId);
            created.push({ id: comboId, etiqueta: label(item) });
          }
        } else {
          const components = item.product.componentes.map((component) => {
            const componentId = idByCode.get(component.codigo);
            if (!componentId) throw new Error(`El componente ${component.codigo} no se pudo importar.`);
            return { componentId, quantity: component.cantidad };
          });
          const have = currentComponents.filter((row) => row.parentId === item.existingId);
          const unchanged = item.existingId !== null && have.length === components.length && components.every((component) => have.some((row) => row.componentId === component.componentId && row.quantity === component.quantity));
          if (!unchanged) {
            const saved = await saveCombo({
              organizationId,
              id: item.existingId,
              data: { name: item.product.nombre, category: item.product.categoria, subcategory: item.product.subcategoria, sku: code, prices: item.product.precio ? { listPrice: item.product.precio } : {} },
              components,
              convertFromUnit: item.convertir,
            });
            if (!saved.ok) {
              failures.push({ codigo: code, mensaje: saved.message });
              failedProducts.add(code);
              continue;
            }
            comboId = saved.combo.id;
            isNew = saved.created;
            idByCode.set(code, comboId);
            if (isNew) created.push({ id: comboId, etiqueta: label(item) });
          }
        }
        const photo = await photoOf(item);
        const photoChanged = await db.$transaction((tx) => writeComboMeta(tx, organizationId, comboId!, item, photo), { timeout: 30_000 });
        idByCode.set(code, comboId!);
        combosDone += 1;
        if (!isNew) updated += 1;
        if (photoChanged) photosSaved += 1;
      } catch (error) {
        console.error(`[import-catalogo] juego ${code}:`, error instanceof Error ? error.message : error);
        failures.push({ codigo: code, mensaje: error instanceof Error ? error.message : "No se pudo importar el juego." });
        failedProducts.add(code);
      }
      advance(1, "Juegos");
    }
  }

  // Categorías declaradas: se crean si faltan, `orden` llena sortOrder y la foto se guarda por nombre normalizado.
  let categoryPhotos = 0;
  for (const entry of plan.categories) {
    const { category } = entry;
    const name = category.subcategoria ? `${category.categoria} › ${category.subcategoria}` : category.categoria;
    try {
      let prepared: Awaited<ReturnType<typeof prepareCategoryPhoto>> | null = null;
      const bytes = entry.foto && input.photos ? input.photos.get(entry.foto) : undefined;
      if (bytes) {
        prepared = await prepareCategoryPhoto(bytes);
        if (!prepared.ok) failures.push({ codigo: `categoría ${name}`, mensaje: `La foto «${category.foto}» no se guardó: ${prepared.error}` });
      }
      const saved = await db.$transaction(async (tx) => {
        const resolved = await resolveInventoryCategory(tx, organizationId, { category: category.categoria, subcategory: category.subcategoria });
        if (!resolved) throw new Error("No se pudo resolver la categoría.");
        if (category.orden !== null) await tx.inventoryCategory.update({ where: { id: resolved.categoryId }, data: { sortOrder: category.orden } });
        if (prepared?.ok) return setCategoryImage(tx, organizationId, resolved.categoryId, prepared.photo);
        return false;
      });
      if (saved) categoryPhotos += 1;
    } catch (error) {
      console.error(`[import-catalogo] categoría ${name}:`, error instanceof Error ? error.message : error);
      failures.push({ codigo: `categoría ${name}`, mensaje: error instanceof Error ? error.message : "No se pudo guardar la categoría." });
    }
  }

  // Fotos extra: después de los productos (necesitan su id). Cada foto se procesa una vez aunque la compartan varios.
  let extraPhotosSaved = 0;
  const preparedExtra = new Map<string, Promise<PreparedPhoto | null>>();
  for (const item of planned) {
    const code = item.product.codigo;
    const itemId = idByCode.get(code);
    if (!itemId || failedProducts.has(code) || item.fotosExtra === null || !input.photos) continue;
    try {
      const ready: PreparedPhoto[] = [];
      for (const name of item.fotosExtra) {
        let promise = preparedExtra.get(name);
        if (!promise) {
          const bytes = input.photos.get(name);
          promise = bytes ? preparePhoto(bytes) : Promise.resolve(null);
          preparedExtra.set(name, promise);
        }
        const photo = await promise;
        if (photo) ready.push(photo);
        else failures.push({ codigo: code, mensaje: `La foto extra «${name}» no se pudo procesar; se importó sin ella.` });
      }
      if (await writeExtraPhotos(organizationId, itemId, ready)) extraPhotosSaved += ready.length;
    } catch (error) {
      console.error(`[import-catalogo] fotos extra de ${code}:`, error instanceof Error ? error.message : error);
      failures.push({ codigo: code, mensaje: error instanceof Error ? error.message : "No se pudieron guardar las fotos extra." });
    }
  }

  // Colecciones: se crean o se actualizan por nombre (sin tildes ni mayúsculas) y se les suman los productos que las nombran.
  let collectionsTouched = 0;
  let collectionPhotos = 0;
  const memberIds = new Map<string, string[]>();
  for (const item of planned) {
    const itemId = idByCode.get(item.product.codigo);
    if (!itemId || failedProducts.has(item.product.codigo)) continue;
    for (const name of item.product.colecciones ?? []) memberIds.set(collectionSlug(name), [...(memberIds.get(collectionSlug(name)) ?? []), itemId]);
  }
  for (const entry of plan.collections) {
    try {
      let prepared: Awaited<ReturnType<typeof prepareImage>> | null = null;
      const bytes = entry.foto && input.photos ? input.photos.get(entry.foto) : undefined;
      if (bytes) {
        prepared = await prepareImage(bytes, COLLECTION_PHOTO_WIDTH);
        if (!prepared.ok) failures.push({ codigo: `colección ${entry.nombre}`, mensaje: `La foto no se guardó: ${prepared.error}` });
      }
      await db.$transaction(async (tx) => {
        const row = await upsertCollectionByName(tx, organizationId, { nombre: entry.nombre, descripcion: entry.descripcion, orden: entry.orden });
        await addItemsToCollection(tx, organizationId, row.id, memberIds.get(collectionSlug(entry.nombre)) ?? []);
        if (prepared?.ok) {
          await tx.collection.updateMany({ where: { id: row.id, organizationId }, data: { imageData: prepared.data, imageMime: prepared.mime } });
          collectionPhotos += 1;
        }
      });
      collectionsTouched += 1;
    } catch (error) {
      console.error(`[import-catalogo] colección ${entry.nombre}:`, error instanceof Error ? error.message : error);
      failures.push({ codigo: `colección ${entry.nombre}`, mensaje: error instanceof Error ? error.message : "No se pudo guardar la colección." });
    }
  }

  const result: ApplyResult = {
    lote: input.lote,
    creados: created,
    actualizados: updated,
    juegos: combosDone,
    fotos: photosSaved,
    fotosCategoria: categoryPhotos,
    fotosExtra: extraPhotosSaved,
    colecciones: collectionsTouched,
    fotosColeccion: collectionPhotos,
    omitidos: plan.summary.omitidos + failedProducts.size,
    fallidos: failures,
    summary: plan.summary,
    problems: plan.problems,
  };

  // Auditoría en lote (mismo patrón que la Carga con IA: entidad IaCarga, `lote` anulable por /api/admin/ia/anular).
  await recordAudit({
    context,
    action: "create",
    entity: "IaCarga",
    entityId: input.lote,
    summary: `Importó un catálogo (${created.length} productos nuevos, ${updated} actualizados, ${combosDone} juegos, ${photosSaved} fotos)`,
    detail: {
      fields: {
        lote: input.lote,
        origen: "importar-catalogo",
        productos: created.map((row) => row.id),
        actualizados: updated,
        juegos: combosDone,
        fotos: photosSaved,
        fotosCategoria: categoryPhotos,
        fotosExtra: extraPhotosSaved,
        colecciones: collectionsTouched,
        omitidos: result.omitidos,
        fallidos: failures.length,
      },
    },
  });
  return result;
}
