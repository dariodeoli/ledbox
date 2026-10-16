import type { StockCountStatus } from "../stock-count";
import { randomUUID } from "node:crypto";
import { Prisma, type BillingUnit } from "@prisma/client";
import type { AudiencePriceTier } from "@/lib/price-tiers";
import { inventorySkuValid, normalizeInventorySku } from "@/lib/field-rules";
import {
  FAMILY_GROUP_LIMIT,
  FAMILY_PRICE_FIELDS,
  axesFromJson,
  deriveFamilyCode,
  mergeAxisValues,
  normalizeVariantText,
  optionsFromJson,
  readFamilyAxes,
  readFamilyCode,
  readFamilyDescription,
  readFamilyName,
  readVariantOptions,
  variantDisplayName,
  variantKey,
  variantNameFits,
  usedAxisValues,
  type FamilyAxis,
  type FamilyView,
  type VariantOptions,
} from "@/lib/inventory-variants";
import { categoryWriteData, resolveInventoryCategory } from "./inventory-categories";
import { createInventoryUnits } from "./inventory-units";
import { replacePriceTiers } from "./price-tier-store";

/**
 * Familias de variantes (docs/VARIANTES.md §2 y §6). **Único escritor** de `InventoryFamily` y de las
 * columnas de variante del producto (`familyId`, `variantOptions`, `variantKey`, `variantOwnPrice`,
 * `variantSortOrder`), y del `name` y la categoría de una variante: al renombrar la familia, cambiar su
 * categoría o los valores de sus ejes se reescriben en la misma transacción, así cada lector actual
 * (presupuestos, remitos, buscador, selector) muestra el nombre completo sin joins.
 *
 * Cada variante es un `InventoryItem` completo: el motor de stock nunca toca la familia. Orden de locks:
 * familia (`FOR UPDATE`) → productos (por id) → evento. Todo id recibido se valida contra la empresa
 * activa; uno ajeno es 404.
 */

type Tx = Prisma.TransactionClient;

export type FamilyFailure = { ok: false; status: 400 | 404 | 409; error: string };
const fail = (status: FamilyFailure["status"], error: string): FamilyFailure => ({ ok: false, status, error });

/** Nombre anterior y nuevo de un producto cuyo nombre reescribió el escritor (para auditar). */
export type VariantRename = { id: string; before: string; after: string };

type FamilyRow = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  categoryId: string | null;
  publicDescription: string | null;
  coverItemId: string | null;
  axes: Prisma.JsonValue;
  archivedAt: Date | null;
};

type VariantRow = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  quantity: number;
  stockCountStatus: StockCountStatus;
  variantOptions: Prisma.JsonValue | null;
  variantOwnPrice: boolean;
  variantSortOrder: number;
  listPrice: number;
  wholesalePrice: number;
  minimumPrice: number;
  listFromDays: number;
  listFromPrice: number;
  wholesaleFromDays: number;
  wholesaleFromPrice: number;
  billingUnit: BillingUnit;
};

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** `true` si algún producto vivo de la empresa usa ese SKU (sin distinguir mayúsculas). */
export async function skuEqualsCode(tx: Pick<Tx, "inventoryItem">, organizationId: string, code: string): Promise<boolean> {
  const hit = await tx.inventoryItem.findFirst({ where: { organizationId, sku: { equals: code, mode: "insensitive" } }, select: { id: true } });
  return Boolean(hit);
}

/** `true` si alguna familia viva de la empresa tiene ese código (sin distinguir mayúsculas). */
export async function familyCodeTaken(tx: Pick<Tx, "inventoryFamily">, organizationId: string, code: string, exceptId?: string): Promise<boolean> {
  const hit = await tx.inventoryFamily.findFirst({
    where: { organizationId, deletedAt: null, code: { equals: code, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Choque de un SKU de producto con el código de una familia (la regla va en las dos direcciones). */
export async function skuClashesWithFamilyCode(tx: Pick<Tx, "inventoryFamily">, organizationId: string, sku: string | null | undefined): Promise<boolean> {
  const value = normalizeInventorySku(sku);
  if (!value) return false;
  return familyCodeTaken(tx, organizationId, value);
}

async function lockFamily(tx: Tx, organizationId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InventoryFamily" WHERE "id" = ${id} AND "organizationId" = ${organizationId} AND "deletedAt" IS NULL FOR UPDATE`;
  return rows.length > 0;
}

async function loadFamily(tx: Tx, organizationId: string, id: string): Promise<FamilyRow | null> {
  return tx.inventoryFamily.findFirst({ where: { id, organizationId, deletedAt: null } });
}

const VARIANT_SELECT = {
  id: true,
  name: true,
  sku: true,
  categoryId: true,
  quantity: true,
  stockCountStatus: true,
  variantOptions: true,
  variantOwnPrice: true,
  variantSortOrder: true,
  listPrice: true,
  wholesalePrice: true,
  minimumPrice: true,
  listFromDays: true,
  listFromPrice: true,
  wholesaleFromDays: true,
  wholesaleFromPrice: true,
  billingUnit: true,
} as const;

async function familyVariants(tx: Tx, organizationId: string, familyId: string): Promise<VariantRow[]> {
  return tx.inventoryItem.findMany({ where: { organizationId, familyId }, orderBy: [{ variantSortOrder: "asc" }, { name: "asc" }], select: VARIANT_SELECT });
}

/** Reescribe nombre y categoría de las variantes de la familia. Devuelve los nombres que cambiaron. */
async function rewriteVariants(tx: Tx, organizationId: string, family: Pick<FamilyRow, "name" | "categoryId">, axes: readonly FamilyAxis[], variants: readonly VariantRow[]): Promise<VariantRename[]> {
  const resolved = family.categoryId ? await resolveInventoryCategory(tx, organizationId, { categoryId: family.categoryId }) : null;
  const renamed: VariantRename[] = [];
  for (const variant of variants) {
    const name = variantDisplayName(family.name, optionsFromJson(variant.variantOptions), axes);
    const nameChanged = name !== variant.name;
    const categoryChanged = resolved ? variant.categoryId !== resolved.categoryId : false;
    if (!nameChanged && !categoryChanged) {
      // El texto espejo de la categoría puede haber cambiado de nombre: se reescribe igual (barato y idempotente).
      if (resolved) await tx.inventoryItem.update({ where: { id: variant.id }, data: categoryWriteData(resolved) });
      continue;
    }
    await tx.inventoryItem.update({ where: { id: variant.id }, data: { ...(nameChanged ? { name } : {}), ...(resolved ? categoryWriteData(resolved) : {}) } });
    if (nameChanged) renamed.push({ id: variant.id, before: variant.name, after: name });
  }
  return renamed;
}

function priceSignature(row: Pick<VariantRow, (typeof FAMILY_PRICE_FIELDS)[number]>): string {
  return FAMILY_PRICE_FIELDS.map((field) => String(row[field])).join("|");
}

type MemberInput = { itemId: unknown; options: unknown };

type PreparedMember = { itemId: string; options: VariantOptions; item: VariantRow & { _count: { components: number }; comboIncomplete: boolean; familyId: string | null } };

/** Valida los productos que se agrupan: de la empresa, vivos, sueltos, no combos; y sus opciones contra los ejes. */
async function prepareMembers(
  tx: Tx,
  organizationId: string,
  axes: readonly FamilyAxis[],
  rawMembers: unknown,
): Promise<{ ok: true; members: PreparedMember[]; axes: FamilyAxis[] } | FamilyFailure> {
  if (!Array.isArray(rawMembers) || rawMembers.length < 1 || rawMembers.length > FAMILY_GROUP_LIMIT) return fail(400, `Elegí de 1 a ${FAMILY_GROUP_LIMIT} productos para la familia.`);
  const inputs = rawMembers as MemberInput[];
  const ids: string[] = [];
  for (const input of inputs) {
    const id = typeof input?.itemId === "string" ? input.itemId : "";
    if (!id) return fail(400, "Falta el producto de una de las variantes.");
    if (ids.includes(id)) return fail(400, "Un producto no puede estar dos veces en la misma familia.");
    ids.push(id);
  }
  // Dos familias distintas también pueden intentar incorporar el mismo producto.
  // Bloquear antes de leer familyId evita que la segunda robe la variante a la primera.
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryItem" WHERE "organizationId" = ${organizationId} AND "id" IN (${Prisma.join([...ids].sort())}) ORDER BY "id" FOR UPDATE`);
  const items = await tx.inventoryItem.findMany({
    where: { organizationId, id: { in: ids } },
    select: { ...VARIANT_SELECT, familyId: true, comboIncomplete: true, _count: { select: { components: true } } },
  });
  if (items.length !== ids.length) return fail(404, "Alguno de los productos no existe en esta empresa.");
  const byId = new Map(items.map((item) => [item.id, item]));
  const members: PreparedMember[] = [];
  for (const input of inputs) {
    const item = byId.get(input.itemId as string)!;
    if (item.familyId) return fail(409, `«${item.name}» ya está en una familia: desvinculalo primero.`);
    if (item._count.components > 0 || item.comboIncomplete) return fail(400, `«${item.name}» es un combo: un combo no puede ser variante.`);
    const parsed = readVariantOptions(input.options, axes);
    if (!parsed.ok) return fail(400, `${item.name}: ${parsed.error}`);
    members.push({ itemId: item.id, options: parsed.options, item });
  }
  const keys = new Set<string>();
  for (const member of members) {
    const key = variantKey(member.options, axes);
    if (keys.has(key)) return fail(400, `Hay dos productos con la misma combinación (${Object.values(member.options).join(" · ")}).`);
    keys.add(key);
  }
  return { ok: true, members, axes: mergeAxisValues(axes, members.map((member) => member.options)) };
}

export type CreateFamilyInput = {
  name: unknown;
  code?: unknown;
  axes: unknown;
  members: unknown;
  categoryId?: unknown;
  publicDescription?: unknown;
};

export type FamilyResult = { ok: true; familyId: string; renamed: VariantRename[] };

/** Agrupa productos sueltos en una familia nueva (la acción masiva «Agrupar en familia»). */
export async function createFamily(tx: Tx, organizationId: string, input: CreateFamilyInput): Promise<FamilyResult | FamilyFailure> {
  const name = readFamilyName(input.name);
  if (!name) return fail(400, "El nombre de la familia va de 2 a 120 caracteres.");
  const axesParsed = readFamilyAxes(input.axes);
  if (!axesParsed.ok) return fail(400, axesParsed.error);
  const description = readFamilyDescription(input.publicDescription);
  if (description === false) return fail(400, "La descripción pública no puede superar 600 caracteres.");
  const rawCode = typeof input.code === "string" && input.code.trim() ? input.code : deriveFamilyCode(name);
  const code = readFamilyCode(rawCode);
  if (!code) return fail(400, "El código de la familia solo admite letras, números, espacios, puntos y guiones (1 a 60).");
  if (await familyCodeTaken(tx, organizationId, code)) return fail(409, `Ya hay una familia con el código «${code}»: elegí otro.`);
  if (await skuEqualsCode(tx, organizationId, code)) return fail(409, `El código «${code}» ya lo usa un producto como SKU: elegí otro para la familia.`);

  const prepared = await prepareMembers(tx, organizationId, axesParsed.axes, input.members);
  if (!prepared.ok) return prepared;
  for (const member of prepared.members) {
    if (!variantNameFits(name, member.options, prepared.axes)) return fail(400, `El nombre completo de «${member.item.name}» supera los 120 caracteres: acortá el nombre de la familia.`);
  }

  let categoryId: string | null = null;
  if (typeof input.categoryId === "string" && input.categoryId) {
    const resolved = await resolveInventoryCategory(tx, organizationId, { categoryId: input.categoryId });
    if (!resolved) return fail(404, "La categoría no existe en esta empresa.");
    categoryId = resolved.categoryId;
  } else {
    categoryId = prepared.members.find((member) => member.item.categoryId)?.item.categoryId ?? null;
  }

  const familyId = `fam_${randomUUID()}`;
  try {
    await tx.inventoryFamily.create({
      data: { id: familyId, organizationId, name, code, categoryId, publicDescription: description, axes: prepared.axes as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    // Dos altas simultáneas con el mismo código: el índice único parcial deja pasar a una sola.
    if (isUniqueViolation(error)) return fail(409, `Ya hay una familia con el código «${code}»: elegí otro.`);
    throw error;
  }
  try {
    const firstSignature = priceSignature(prepared.members[0].item);
    for (const [index, member] of prepared.members.entries()) {
      await tx.inventoryItem.update({
        where: { id: member.itemId },
        data: {
          familyId,
          variantOptions: member.options as Prisma.InputJsonValue,
          variantKey: variantKey(member.options, prepared.axes),
          variantOwnPrice: priceSignature(member.item) !== firstSignature,
          variantSortOrder: index,
        },
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "Ya existe una variante con esa combinación en la familia.");
    throw error;
  }
  const variants = await familyVariants(tx, organizationId, familyId);
  const renamed = await rewriteVariants(tx, organizationId, { name, categoryId }, prepared.axes, variants);
  return { ok: true, familyId, renamed };
}

export type UpdateFamilyInput = {
  name?: unknown;
  code?: unknown;
  categoryId?: unknown;
  axes?: unknown;
  publicDescription?: unknown;
  coverItemId?: unknown;
  archived?: unknown;
};

/** Edita la familia y propaga nombre, categoría y valores de ejes a sus variantes en la misma transacción. */
export async function updateFamily(tx: Tx, organizationId: string, id: string, input: UpdateFamilyInput): Promise<(FamilyResult & { before: { name: string; code: string } }) | FamilyFailure> {
  if (!(await lockFamily(tx, organizationId, id))) return fail(404, "La familia no existe en esta empresa.");
  const family = await loadFamily(tx, organizationId, id);
  if (!family) return fail(404, "La familia no existe en esta empresa.");
  const currentAxes = axesFromJson(family.axes);
  const variants = await familyVariants(tx, organizationId, id);

  const data: Prisma.InventoryFamilyUpdateInput = {};
  let name = family.name;
  if (input.name !== undefined) {
    const next = readFamilyName(input.name);
    if (!next) return fail(400, "El nombre de la familia va de 2 a 120 caracteres.");
    name = next;
    data.name = next;
  }
  if (input.code !== undefined) {
    const code = readFamilyCode(input.code);
    if (!code) return fail(400, "El código de la familia solo admite letras, números, espacios, puntos y guiones (1 a 60).");
    if (code !== family.code) {
      if (await familyCodeTaken(tx, organizationId, code, id)) return fail(409, `Ya hay una familia con el código «${code}»: elegí otro.`);
      if (await skuEqualsCode(tx, organizationId, code)) return fail(409, `El código «${code}» ya lo usa un producto como SKU: elegí otro para la familia.`);
      data.code = code;
    }
  }
  let categoryId = family.categoryId;
  if (input.categoryId !== undefined) {
    if (typeof input.categoryId !== "string" || !input.categoryId) return fail(400, "Elegí una categoría.");
    const resolved = await resolveInventoryCategory(tx, organizationId, { categoryId: input.categoryId });
    if (!resolved) return fail(404, "La categoría no existe en esta empresa.");
    categoryId = resolved.categoryId;
    data.category = { connect: { id: resolved.categoryId } };
  }
  if (input.publicDescription !== undefined) {
    const description = readFamilyDescription(input.publicDescription);
    if (description === false) return fail(400, "La descripción pública no puede superar 600 caracteres.");
    data.publicDescription = description;
  }
  if (input.coverItemId !== undefined) {
    if (input.coverItemId === null || input.coverItemId === "") data.coverItemId = null;
    else {
      const cover = variants.find((variant) => variant.id === input.coverItemId);
      // Un id ajeno o que no es de la familia es 404: nunca se confirma que existe en otra empresa.
      if (!cover) return fail(404, "La variante de la portada no existe en esta familia.");
      data.coverItemId = cover.id;
    }
  }
  if (input.archived !== undefined) data.archivedAt = input.archived ? family.archivedAt ?? new Date() : null;

  let axes = currentAxes;
  if (input.axes !== undefined) {
    const parsed = readFamilyAxes(input.axes);
    if (!parsed.ok) return fail(400, parsed.error);
    const sameKeys = parsed.axes.length === currentAxes.length && parsed.axes.every((axis, index) => axis.key === currentAxes[index].key);
    if (!sameKeys) return fail(400, "Los ejes de una familia no se pueden cambiar; creá otra familia si necesitás otros.");
    for (const axis of parsed.axes) {
      const inUse = usedAxisValues(axis.key, variants.map((variant) => optionsFromJson(variant.variantOptions)));
      for (const used of inUse) {
        if (!axis.values.some((entry) => normalizeVariantText(entry.value) === used)) return fail(409, `No se puede quitar un valor de «${axis.label}» que usa una variante: desvinculá la variante primero.`);
      }
    }
    axes = parsed.axes.map((axis, index) => ({ ...axis, label: currentAxes[index].label }));
    data.axes = axes as unknown as Prisma.InputJsonValue;
  }
  for (const variant of variants) {
    if (!variantNameFits(name, optionsFromJson(variant.variantOptions), axes)) return fail(400, "El nombre completo de alguna variante superaría los 120 caracteres: acortá el nombre de la familia.");
  }
  if (Object.keys(data).length > 0) await tx.inventoryFamily.update({ where: { id }, data });
  const renamed = await rewriteVariants(tx, organizationId, { name, categoryId }, axes, variants);
  return { ok: true, familyId: id, renamed, before: { name: family.name, code: family.code } };
}

export type NewVariantInput = {
  options: unknown;
  sku: unknown;
  quantity?: unknown;
  templateItemId?: unknown;
};

/** Máximo de unidades que «Agregar variante» crea de una vez. */
export const NEW_VARIANT_MAX_UNITS = 500;

/**
 * «Agregar variante»: un producto nuevo que copia cobro, precios (escalones incluidos), categoría,
 * medidas y costos de una variante de referencia. Pide código (SKU) nuevo y crea 0 o N unidades. Nace
 * oculto en la tienda: lo publica la persona cuando tenga stock y foto.
 */
export async function addNewVariant(tx: Tx, organizationId: string, familyId: string, input: NewVariantInput): Promise<{ ok: true; itemId: string; name: string } | FamilyFailure> {
  if (!(await lockFamily(tx, organizationId, familyId))) return fail(404, "La familia no existe en esta empresa.");
  const family = await loadFamily(tx, organizationId, familyId);
  if (!family) return fail(404, "La familia no existe en esta empresa.");
  const axes = axesFromJson(family.axes);
  const options = readVariantOptions(input.options, axes);
  if (!options.ok) return fail(400, options.error);
  const sku = normalizeInventorySku(typeof input.sku === "string" ? input.sku : "");
  if (!sku || !inventorySkuValid(sku)) return fail(400, "El código (SKU) solo admite letras, números, espacios, puntos y guiones (1 a 60).");
  if (await familyCodeTaken(tx, organizationId, sku)) return fail(409, `El código «${sku}» ya lo usa una familia: elegí otro.`);
  if (await tx.inventoryItem.findFirst({ where: { organizationId, sku }, select: { id: true } })) return fail(409, `Ya hay un ítem con el SKU «${sku}»; probá con otro.`);
  const quantity = input.quantity === undefined || input.quantity === null || input.quantity === "" ? 0 : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > NEW_VARIANT_MAX_UNITS) return fail(400, `Las unidades van de 0 a ${NEW_VARIANT_MAX_UNITS}.`);

  const siblings = await familyVariants(tx, organizationId, familyId);
  const key = variantKey(options.options, axes);
  if (siblings.some((sibling) => variantKey(optionsFromJson(sibling.variantOptions), axes) === key)) return fail(409, `Ya existe la variante ${Object.values(options.options).join(" · ")} en esta familia.`);
  const templateId = typeof input.templateItemId === "string" && input.templateItemId ? input.templateItemId : siblings[0]?.id;
  const template = templateId && siblings.some((sibling) => sibling.id === templateId)
    ? await tx.inventoryItem.findFirst({ where: { id: templateId, organizationId, familyId }, omit: { imageData: true } })
    : null;
  if (typeof input.templateItemId === "string" && input.templateItemId && !template) return fail(404, "La variante de referencia no existe en esta familia.");
  const merged = mergeAxisValues(axes, [options.options]);
  const name = variantDisplayName(family.name, options.options, merged);
  if (!variantNameFits(family.name, options.options, merged)) return fail(400, "El nombre completo de la variante supera los 120 caracteres.");
  // La categoría: la de la familia o, si todavía no tiene, la de la variante de referencia (siempre por el helper único).
  const resolved = await resolveInventoryCategory(
    tx,
    organizationId,
    family.categoryId ? { categoryId: family.categoryId } : template?.categoryId ? { categoryId: template.categoryId } : { category: template?.category ?? "Sin categoría" },
  );
  if (!resolved) return fail(404, "La categoría no existe en esta empresa.");

  const id = randomUUID();
  try {
    await tx.inventoryItem.create({
      data: {
        id,
        organizationId,
        name,
        ...categoryWriteData(resolved),
        sku,
        kind: template?.kind ?? "REUSABLE",
        quantity: 0,
        listPrice: template?.listPrice ?? 0,
        listFromDays: template?.listFromDays ?? 0,
        listFromPrice: template?.listFromPrice ?? 0,
        wholesalePrice: template?.wholesalePrice ?? 0,
        wholesaleFromDays: template?.wholesaleFromDays ?? 0,
        wholesaleFromPrice: template?.wholesaleFromPrice ?? 0,
        minimumPrice: template?.minimumPrice ?? 0,
        billingUnit: template?.billingUnit ?? "DAILY",
        capacity: template?.capacity ?? null,
        dimensions: template?.dimensions ?? null,
        replacementCost: template?.replacementCost ?? 0,
        dailyCost: template?.dailyCost ?? 0,
        bufferBeforeMin: template?.bufferBeforeMin ?? null,
        bufferAfterMin: template?.bufferAfterMin ?? null,
        defaultWarehouseId: template?.defaultWarehouseId ?? null,
        defaultLocation: template?.defaultLocation ?? null,
        visibleOnWeb: false,
        catalogAudience: "HIDDEN",
        familyId,
        variantOptions: options.options as Prisma.InputJsonValue,
        variantKey: key,
        variantOwnPrice: false,
        variantSortOrder: siblings.reduce((max, sibling) => Math.max(max, sibling.variantSortOrder), -1) + 1,
      },
    });
  } catch (error) {
    // Misma combinación (o mismo SKU) creada a la vez por otra persona: una gana y la otra recibe 409.
    if (isUniqueViolation(error)) return fail(409, `Ya existe la variante ${Object.values(options.options).join(" · ")} o el SKU «${sku}» en esta empresa.`);
    throw error;
  }
  if (template) {
    const tiers = (await tx.inventoryPriceTier.findMany({
      where: { organizationId, inventoryId: template.id },
      orderBy: [{ audience: "asc" }, { fromDays: "asc" }],
      select: { audience: true, fromDays: true, mode: true, price: true },
    })) as AudiencePriceTier[];
    if (tiers.length) await replacePriceTiers(tx, organizationId, id, tiers);
  }
  if (quantity > 0) await createInventoryUnits(tx, { organizationId, inventoryId: id, name, quantity });
  if (merged.some((axis, index) => axis.values.length !== axes[index].values.length)) {
    await tx.inventoryFamily.update({ where: { id: familyId }, data: { axes: merged as unknown as Prisma.InputJsonValue } });
  }
  return { ok: true, itemId: id, name };
}

/** Suma productos sueltos que ya existen a una familia (con sus opciones). Renombra cada uno al nombre completo. */
export async function addExistingVariants(tx: Tx, organizationId: string, familyId: string, rawMembers: unknown): Promise<FamilyResult | FamilyFailure> {
  if (!(await lockFamily(tx, organizationId, familyId))) return fail(404, "La familia no existe en esta empresa.");
  const family = await loadFamily(tx, organizationId, familyId);
  if (!family) return fail(404, "La familia no existe en esta empresa.");
  const axes = axesFromJson(family.axes);
  const prepared = await prepareMembers(tx, organizationId, axes, rawMembers);
  if (!prepared.ok) return prepared;
  const siblings = await familyVariants(tx, organizationId, familyId);
  const taken = new Set(siblings.map((sibling) => variantKey(optionsFromJson(sibling.variantOptions), axes)));
  for (const member of prepared.members) {
    if (taken.has(variantKey(member.options, prepared.axes))) return fail(409, `Ya existe la variante ${Object.values(member.options).join(" · ")} en esta familia.`);
    if (!variantNameFits(family.name, member.options, prepared.axes)) return fail(400, `El nombre completo de «${member.item.name}» supera los 120 caracteres.`);
  }
  let order = siblings.reduce((max, sibling) => Math.max(max, sibling.variantSortOrder), -1);
  const reference = siblings[0];
  try {
    for (const member of prepared.members) {
      order += 1;
      await tx.inventoryItem.update({
        where: { id: member.itemId },
        data: {
          familyId,
          variantOptions: member.options as Prisma.InputJsonValue,
          variantKey: variantKey(member.options, prepared.axes),
          // Un producto que ya tenía otro precio lo conserva: queda como precio propio.
          variantOwnPrice: reference ? priceSignature(member.item) !== priceSignature(reference) : false,
          variantSortOrder: order,
        },
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "Ya existe una variante con esa combinación en la familia.");
    throw error;
  }
  if (prepared.axes.some((axis, index) => axis.values.length !== axes[index].values.length)) {
    await tx.inventoryFamily.update({ where: { id: familyId }, data: { axes: prepared.axes as unknown as Prisma.InputJsonValue } });
  }
  const variants = await familyVariants(tx, organizationId, familyId);
  const renamed = await rewriteVariants(tx, organizationId, { name: family.name, categoryId: family.categoryId }, prepared.axes, variants);
  return { ok: true, familyId, renamed };
}

/** Desvincula una variante: vuelve a ser un producto suelto, con su nombre completo, stock y precio. */
export async function unlinkVariant(tx: Tx, organizationId: string, familyId: string, itemId: string): Promise<{ ok: true; name: string } | FamilyFailure> {
  if (!(await lockFamily(tx, organizationId, familyId))) return fail(404, "La familia no existe en esta empresa.");
  const item = await tx.inventoryItem.findFirst({ where: { id: itemId, organizationId, familyId }, select: { id: true, name: true } });
  if (!item) return fail(404, "La variante no existe en esta familia.");
  await tx.inventoryItem.update({ where: { id: item.id }, data: { familyId: null, variantOptions: Prisma.DbNull, variantKey: null, variantOwnPrice: false, variantSortOrder: 0 } });
  await tx.inventoryFamily.updateMany({ where: { id: familyId, organizationId, coverItemId: item.id }, data: { coverItemId: null } });
  return { ok: true, name: item.name };
}

/**
 * La familia a la papelera: sale de las listas y sus variantes se desvinculan (vuelven a ser productos
 * sueltos con su nombre, stock y precio). El código queda libre. Al restaurar no se re-vincula sola.
 */
export async function trashFamily(tx: Tx, organizationId: string, familyId: string, deletedById: string | null, reason: string | null): Promise<{ ok: true; name: string; unlinked: number } | FamilyFailure> {
  if (!(await lockFamily(tx, organizationId, familyId))) return fail(404, "La familia no existe en esta empresa.");
  const family = await loadFamily(tx, organizationId, familyId);
  if (!family) return fail(404, "La familia no existe en esta empresa.");
  const unlinked = await tx.inventoryItem.updateMany({
    where: { organizationId, familyId },
    data: { familyId: null, variantOptions: Prisma.DbNull, variantKey: null, variantOwnPrice: false, variantSortOrder: 0 },
  });
  await tx.inventoryFamily.update({ where: { id: familyId }, data: { deletedAt: new Date(), deletedById, deleteReason: reason?.slice(0, 200) || null, coverItemId: null } });
  return { ok: true, name: family.name, unlinked: unlinked.count };
}

/**
 * «Mismo precio para todas»: copia lista, mayorista, mínimo, cobro y escalones de la variante de
 * referencia a las variantes sin precio propio, en una sola transacción. La de referencia y las que
 * tienen precio propio no se tocan.
 */
export async function applySamePrice(tx: Tx, organizationId: string, familyId: string, sourceItemId: unknown): Promise<{ ok: true; updatedIds: string[]; skipped: number } | FamilyFailure> {
  if (!(await lockFamily(tx, organizationId, familyId))) return fail(404, "La familia no existe en esta empresa.");
  const variants = await familyVariants(tx, organizationId, familyId);
  const source = variants.find((variant) => variant.id === sourceItemId);
  if (!source) return fail(404, "La variante de referencia no existe en esta familia.");
  const targets = variants.filter((variant) => variant.id !== source.id && !variant.variantOwnPrice);
  const tiers = (await tx.inventoryPriceTier.findMany({
    where: { organizationId, inventoryId: source.id },
    orderBy: [{ audience: "asc" }, { fromDays: "asc" }],
    select: { audience: true, fromDays: true, mode: true, price: true },
  })) as AudiencePriceTier[];
  const prices = Object.fromEntries(FAMILY_PRICE_FIELDS.map((field) => [field, source[field]])) as Pick<VariantRow, (typeof FAMILY_PRICE_FIELDS)[number]>;
  for (const target of targets) {
    await tx.inventoryItem.update({ where: { id: target.id }, data: prices });
    await replacePriceTiers(tx, organizationId, target.id, tiers);
  }
  return { ok: true, updatedIds: targets.map((target) => target.id), skipped: variants.length - 1 - targets.length };
}

/** Marca que el precio de un producto lo cargó la persona (se llama al editar precios de una variante). */
export async function markOwnPrice(tx: Pick<Tx, "inventoryItem">, organizationId: string, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await tx.inventoryItem.updateMany({ where: { organizationId, id: { in: [...itemIds] }, familyId: { not: null } }, data: { variantOwnPrice: true } });
}

// ── Lectura ───────────────────────────────────────────────────────────────────

export type { FamilyView };

function toView(family: FamilyRow, variants: readonly VariantRow[]): FamilyView {
  return {
    id: family.id,
    name: family.name,
    code: family.code,
    categoryId: family.categoryId,
    publicDescription: family.publicDescription,
    coverItemId: family.coverItemId,
    axes: axesFromJson(family.axes),
    archivedAt: family.archivedAt ? family.archivedAt.toISOString() : null,
    variants: variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      quantity: variant.quantity,
      stockCountStatus: variant.stockCountStatus,
      options: optionsFromJson(variant.variantOptions),
      ownPrice: variant.variantOwnPrice,
      sortOrder: variant.variantSortOrder,
      listPrice: variant.listPrice,
      wholesalePrice: variant.wholesalePrice,
      minimumPrice: variant.minimumPrice,
      billingUnit: variant.billingUnit,
    })),
  };
}

/** Una familia viva de la empresa con sus variantes; `null` si no existe o es de otra empresa. */
export async function getFamilyView(tx: Tx, organizationId: string, id: string): Promise<FamilyView | null> {
  const family = await loadFamily(tx, organizationId, id);
  if (!family) return null;
  return toView(family, await familyVariants(tx, organizationId, id));
}

/** Familias vivas de la empresa con sus variantes (dos consultas, sin N+1). */
export async function listFamilyViews(tx: Tx, organizationId: string): Promise<FamilyView[]> {
  const families = await tx.inventoryFamily.findMany({ where: { organizationId, deletedAt: null }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1000 });
  if (families.length === 0) return [];
  const items = await tx.inventoryItem.findMany({
    where: { organizationId, familyId: { in: families.map((family) => family.id) } },
    orderBy: [{ variantSortOrder: "asc" }, { name: "asc" }],
    select: { ...VARIANT_SELECT, familyId: true },
  });
  const byFamily = new Map<string, VariantRow[]>();
  for (const item of items) {
    const list = byFamily.get(item.familyId!) ?? [];
    list.push(item);
    byFamily.set(item.familyId!, list);
  }
  return families.map((family) => toView(family, byFamily.get(family.id) ?? []));
}

/** Hermanas de una variante (ids), para `findSubstitutes`. Vacío si no está en una familia. */
export async function siblingIdsOf(tx: Pick<Tx, "inventoryItem">, organizationId: string, itemId: string): Promise<{ familyId: string | null; siblingIds: string[] }> {
  const item = await tx.inventoryItem.findFirst({ where: { id: itemId, organizationId }, select: { familyId: true } });
  if (!item?.familyId) return { familyId: null, siblingIds: [] };
  const siblings = await tx.inventoryItem.findMany({ where: { organizationId, familyId: item.familyId, id: { not: itemId } }, select: { id: true } });
  return { familyId: item.familyId, siblingIds: siblings.map((sibling) => sibling.id) };
}
