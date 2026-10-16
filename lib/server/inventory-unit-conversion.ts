import type { Prisma } from "@prisma/client";

/** Metadata that a unit→combo conversion cannot discard, shared by preview and writer. */
export const UNIT_CONVERSION_METADATA: Prisma.InventoryUnitWhereInput[] = [
  { purchaseCost: { not: 0 } }, { notes: { not: null } },
  { stockOrigin: { not: null } }, { ownerSupplierId: { not: null } },
  { warehouseId: { not: null } }, { location: { not: null } },
  { conditionScore: { not: null } }, { supplierId: { not: null } },
  { purchasedAt: { not: null } }, { warrantyUntil: { not: null } },
  { incidentCycle: { not: 0 } },
];
