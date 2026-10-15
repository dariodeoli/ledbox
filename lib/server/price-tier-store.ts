import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AudiencePriceTier } from "@/lib/price-tiers";

type Tx = Pick<Prisma.TransactionClient, "inventoryPriceTier">;

const key = (tier: AudiencePriceTier) => `${tier.audience}:${tier.fromDays}:${tier.mode}:${tier.price}`;

/**
 * Reemplaza los escalones de un producto de la empresa (todo o nada dentro de la transacción del
 * llamador). Devuelve si algo cambió y los escalones anteriores, para auditar.
 */
export async function replacePriceTiers(
  tx: Tx,
  organizationId: string,
  inventoryId: string,
  next: ReadonlyArray<AudiencePriceTier>,
): Promise<{ changed: boolean; before: AudiencePriceTier[] }> {
  const rows = await tx.inventoryPriceTier.findMany({
    where: { organizationId, inventoryId },
    orderBy: [{ audience: "asc" }, { fromDays: "asc" }],
    select: { audience: true, fromDays: true, mode: true, price: true },
  });
  const before: AudiencePriceTier[] = rows;
  const same = before.length === next.length && before.map(key).join("|") === [...next].sort((a, b) => a.audience.localeCompare(b.audience) || a.fromDays - b.fromDays).map(key).join("|");
  if (same) return { changed: false, before };
  await tx.inventoryPriceTier.deleteMany({ where: { organizationId, inventoryId } });
  if (next.length) {
    await tx.inventoryPriceTier.createMany({
      data: next.map((tier, sortOrder) => ({ id: randomUUID(), organizationId, inventoryId, audience: tier.audience, fromDays: tier.fromDays, mode: tier.mode, price: tier.price, sortOrder })),
    });
  }
  return { changed: true, before };
}

/** Reemplaza solo los escalones de UN frente (la importación toca el cliente final y respeta los mayoristas). */
export async function replaceAudienceTiers(
  tx: Tx,
  organizationId: string,
  inventoryId: string,
  audience: AudiencePriceTier["audience"],
  next: ReadonlyArray<Omit<AudiencePriceTier, "audience">>,
): Promise<void> {
  const keep = (await tx.inventoryPriceTier.findMany({
    where: { organizationId, inventoryId, audience: { not: audience } },
    select: { audience: true, fromDays: true, mode: true, price: true },
  })) as AudiencePriceTier[];
  await replacePriceTiers(tx, organizationId, inventoryId, [...keep, ...next.map((tier) => ({ ...tier, audience }))]);
}
