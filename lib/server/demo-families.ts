import type { Prisma } from "@prisma/client";
import { variantDisplayName, variantKey, type FamilyAxis } from "@/lib/inventory-variants";

/**
 * Familias de variantes de la demo (docs/VARIANTES.md): «Plato Arabesco» en verde y lila, y «Zapato Ola»
 * en negro/blanco, talles 35 y 36. Cada variante es un producto completo con sus unidades; la familia solo
 * las agrupa. Los ids son `demo_*` (la sandbox los reescribe). La categoría de la familia se completa
 * después de sembrar la taxonomía, copiándola de sus productos.
 */

type DemoVariant = { key: string; options: Record<string, string>; quantity: number; price: number; wholesale: number; sku: string; unitPrefix: string };
type DemoFamily = { id: string; name: string; code: string; category: string; axes: FamilyAxis[]; billingUnit: "DAILY" | "EVENT"; replacementCost: number; dailyCost: number; description: string; variants: DemoVariant[] };

const COLORS: Record<string, string> = { Verde: "#4B6B3A", Lila: "#9B7BB8", Negro: "#1F1F1F", Blanco: "#F5F5F5" };
const colorAxis = (values: string[]): FamilyAxis => ({ key: "color", label: "Color", values: values.map((value) => ({ value, swatch: COLORS[value] })) });

const FAMILIES: DemoFamily[] = [
  {
    id: "demo_fam_plato_arabesco",
    name: "Plato Arabesco",
    code: "PLATO-ARABESCO",
    category: "Vajilla",
    axes: [colorAxis(["Verde", "Lila"])],
    billingUnit: "DAILY",
    replacementCost: 35_000,
    dailyCost: 1_500,
    description: "Plato llano de porcelana con dibujo arabesco, 27 cm.",
    variants: [
      { key: "verde", options: { color: "Verde" }, quantity: 24, price: 6_000, wholesale: 4_500, sku: "ARA-VER", unitPrefix: "ARA-VER" },
      { key: "lila", options: { color: "Lila" }, quantity: 30, price: 6_000, wholesale: 4_500, sku: "ARA-LIL", unitPrefix: "ARA-LIL" },
    ],
  },
  {
    id: "demo_fam_zapato_ola",
    name: "Zapato Ola",
    code: "ZAPATO-OLA",
    category: "Calzado",
    axes: [colorAxis(["Negro", "Blanco"]), { key: "talle", label: "Talle", values: [{ value: "35" }, { value: "36" }] }],
    billingUnit: "EVENT",
    replacementCost: 180_000,
    dailyCost: 0,
    description: "Zapato de salón de la línea Ola, para presentaciones y desfiles.",
    variants: [
      { key: "negro_35", options: { color: "Negro", talle: "35" }, quantity: 1, price: 70_000, wholesale: 55_000, sku: "OLA-NEG-35", unitPrefix: "OLA-NEG35" },
      { key: "negro_36", options: { color: "Negro", talle: "36" }, quantity: 2, price: 70_000, wholesale: 55_000, sku: "OLA-NEG-36", unitPrefix: "OLA-NEG36" },
      { key: "blanco_35", options: { color: "Blanco", talle: "35" }, quantity: 3, price: 70_000, wholesale: 55_000, sku: "OLA-BLA-35", unitPrefix: "OLA-BLA35" },
      { key: "blanco_36", options: { color: "Blanco", talle: "36" }, quantity: 2, price: 70_000, wholesale: 55_000, sku: "OLA-BLA-36", unitPrefix: "OLA-BLA36" },
    ],
  },
];

export function buildDemoFamilies(organizationId: string, createdAt: Date): {
  families: Prisma.InventoryFamilyUncheckedCreateInput[];
  items: Prisma.InventoryItemUncheckedCreateInput[];
  units: Prisma.InventoryUnitUncheckedCreateInput[];
  /** Categoría (texto) de cada familia, para completar `categoryId` después de sembrar la taxonomía. */
  familyCategories: Array<{ familyId: string; category: string }>;
} {
  const families: Prisma.InventoryFamilyUncheckedCreateInput[] = [];
  const items: Prisma.InventoryItemUncheckedCreateInput[] = [];
  const units: Prisma.InventoryUnitUncheckedCreateInput[] = [];
  for (const family of FAMILIES) {
    families.push({ id: family.id, organizationId, name: family.name, code: family.code, publicDescription: family.description, axes: family.axes as unknown as Prisma.InputJsonValue, createdAt });
    family.variants.forEach((variant, index) => {
      const id = `demo_inv_${family.id.replace(/^demo_fam_/, "")}_${variant.key}`;
      items.push({
        id,
        organizationId,
        name: variantDisplayName(family.name, variant.options, family.axes),
        category: family.category,
        sku: variant.sku,
        kind: "REUSABLE",
        quantity: variant.quantity,
        replacementCost: family.replacementCost,
        dailyCost: family.dailyCost,
        listPrice: variant.price,
        wholesalePrice: variant.wholesale,
        billingUnit: family.billingUnit,
        visibleOnWeb: true,
        catalogAudience: "BOTH",
        publicDescription: family.description,
        familyId: family.id,
        variantOptions: variant.options as Prisma.InputJsonValue,
        variantKey: variantKey(variant.options, family.axes),
        variantOwnPrice: false,
        variantSortOrder: index,
        createdAt,
      });
      for (let unit = 1; unit <= variant.quantity; unit += 1) {
        units.push({
          id: `demo_unit_${id.replace(/^demo_inv_/, "")}_${unit}`,
          organizationId,
          inventoryId: id,
          code: `${variant.unitPrefix}-${String(unit).padStart(2, "0")}`,
          status: "AVAILABLE",
          purchaseCost: family.replacementCost,
          notes: null,
          createdAt,
        });
      }
    });
  }
  return { families, items, units, familyCategories: FAMILIES.map((family) => ({ familyId: family.id, category: family.category })) };
}
