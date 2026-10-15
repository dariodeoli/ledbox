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
import { recordAudit, type AuditContext } from "@/lib/server/audit";
import { createInventoryUnits, isUniqueConstraintError } from "@/lib/server/inventory-units";
import { saveCombo } from "@/lib/server/inventory-combos";
import { categoryWriteData, resolveInventoryCategory } from "@/lib/server/inventory-categories";
import { findWarehouseByCode } from "@/lib/server/inventory-warehouses";
import { lockInventoryItems } from "@/lib/server/inventory-availability";
import { replaceAudienceTiers } from "@/lib/server/price-tier-store";
import { preparePhoto, type PreparedPhoto } from "@/lib/server/import-photos";
import {
  codesToLookUp,
  planCatalog,
  type CatalogPlan,
  type CatalogProduct,
  type ExistingItem,
  type ImportProblem,
  type PlannedProduct,
} from "@/lib/import-catalog";

const BLOCK_SIZE = 25;

/** `cobro` del catálogo → `InventoryItem.billingUnit` (docs/ALQUILERES-OPERACION.md P1-1). */
const billingUnitOf = (cobro: "evento" | "dia") => (cobro === "evento" ? ("EVENT" as const) : ("DAILY" as const));

/** Lo que hay en la empresa para esos códigos (incluye la papelera). */
export async function loadExisting(organizationId: string, codes: string[]): Promise<Map<string, ExistingItem>> {
  const rows = codes.length
    ? await dbWithDeleted.inventoryItem.findMany({
        where: { organizationId, sku: { in: codes } },
        select: { id: true, sku: true, name: true, deletedAt: true, _count: { select: { components: true, units: true } } },
      })
    : [];
  return new Map(
    rows.flatMap((row) =>
      row.sku
        ? [[row.sku, { id: row.id, name: row.name, isCombo: row._count.components > 0, inTrash: row.deletedAt !== null, units: row._count.units } satisfies ExistingItem] as const]
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
  });
}

export type ApplyFailure = { codigo: string; mensaje: string };

export type ApplyResult = {
  lote: string;
  creados: Array<{ id: string; etiqueta: string }>;
  actualizados: number;
  juegos: number;
  fotos: number;
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

/** Escribe el alta o la actualización de un producto-unidad dentro de una transacción. */
async function writeUnitItem(tx: Tx, organizationId: string, planned: PlannedProduct, photo: PreparedPhoto | null): Promise<Outcome> {
  const { product } = planned;
  // Categoría y subcategoría: se crean o se asocian con el helper único (sin duplicar padre ni hija).
  const category = await resolveInventoryCategory(tx, organizationId, { category: product.categoria, subcategory: product.subcategoria });
  if (!category) throw new Error("No se pudo resolver la categoría.");
  const warehouse = product.deposito ? await findWarehouseByCode(tx, organizationId, product.deposito) : null;
  const baseData = {
    name: product.nombre,
    ...categoryWriteData(category),
    publicDescription: planned.publicDescription,
    billingUnit: billingUnitOf(product.cobro),
    ...(product.precio ? { listPrice: product.precio } : {}),
  };
  if (planned.existingId) {
    const locked = await lockInventoryItems(tx, organizationId, [planned.existingId]);
    if (!locked.has(planned.existingId)) throw new Error("El producto ya no existe en esta empresa.");
    const current = await tx.inventoryItem.findFirst({
      where: { id: planned.existingId, organizationId },
      select: { catalogAudience: true, visibleOnWeb: true, imageData: true, quantity: true, _count: { select: { components: true } } },
    });
    if (!current) throw new Error("El producto ya no existe en esta empresa.");
    if (current._count.components > 0) throw new Error("Ahora es un juego en el inventario; no se cambia el tipo por importación.");
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
  return { id, created: true, photo: Boolean(photo) };
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
      billingUnit: billingUnitOf(product.cobro),
      ...(product.precio ? { listPrice: product.precio } : {}),
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
          for (const item of block) list.push([item, await writeUnitItem(tx, organizationId, item, blockPhotos.get(item.product.codigo) ?? null)]);
          return list;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      for (const [item, outcome] of outcomes) note(outcome, item);
    } catch (blockError) {
      console.error("[import-catalogo] Bloque revertido, se reintenta producto por producto:", blockError instanceof Error ? blockError.message : blockError);
      for (const item of block) {
        try {
          const outcome = await db.$transaction((tx) => writeUnitItem(tx, organizationId, item, blockPhotos.get(item.product.codigo) ?? null), { timeout: 30_000 });
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
        const components = item.product.componentes.map((component) => {
          const componentId = idByCode.get(component.codigo);
          if (!componentId) throw new Error(`El componente ${component.codigo} no se pudo importar.`);
          return { componentId, quantity: component.cantidad };
        });
        const have = currentComponents.filter((row) => row.parentId === item.existingId);
        const unchanged = item.existingId !== null && have.length === components.length && components.every((component) => have.some((row) => row.componentId === component.componentId && row.quantity === component.quantity));
        let comboId = item.existingId;
        let isNew = false;
        if (!unchanged) {
          const saved = await saveCombo({
            organizationId,
            id: item.existingId,
            data: { name: item.product.nombre, category: item.product.categoria, subcategory: item.product.subcategoria, sku: code, prices: item.product.precio ? { listPrice: item.product.precio } : {} },
            components,
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

  const result: ApplyResult = {
    lote: input.lote,
    creados: created,
    actualizados: updated,
    juegos: combosDone,
    fotos: photosSaved,
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
        omitidos: result.omitidos,
        fallidos: failures.length,
      },
    },
  });
  return result;
}
