import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const [suppliers, inventory, promoters] = await Promise.all([
    db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 200 }),
    db.inventoryItem.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 300 }),
    db.promoter.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" }, take: 200 }),
  ]);
  return Response.json({ suppliers, inventory, promoters });
}

export async function POST(request: Request) {
  const body = await readJson(request) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "supplier") {
    const auth = await requireAdminContext("suppliers.write");
    if (!auth.ok) return auth.response;
    if (typeof body.name !== "string") return jsonError("Name is required.", 400);
    const supplier = await db.supplier.create({
      data: {
        id: randomUUID(),
        organizationId: auth.context.organizationId,
        name: body.name.trim(),
        company: typeof body.company === "string" ? body.company.trim() : undefined,
        phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
        category: "OTHER",
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Supplier",
      entityId: supplier.id,
      summary: `Cargó el proveedor «${supplier.name}»`,
      detail: { fields: auditPick(supplier, ["name", "company", "phone", "category", "active"]) },
    });
    return Response.json({ supplier }, { status: 201 });
  }

  if (kind === "inventory") {
    const auth = await requireAdminContext("inventory.write");
    if (!auth.ok) return auth.response;
    if (typeof body.name !== "string") return jsonError("Name is required.", 400);
    const inventory = await db.inventoryItem.create({
      data: {
        id: randomUUID(),
        organizationId: auth.context.organizationId,
        name: body.name.trim(),
        category: typeof body.category === "string" ? body.category.trim() : "General",
        kind: body.inventoryKind === "CONSUMABLE" ? "CONSUMABLE" : body.inventoryKind === "DISPOSABLE" ? "DISPOSABLE" : "REUSABLE",
        quantity: typeof body.quantity === "number" ? body.quantity : 1,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "InventoryItem",
      entityId: inventory.id,
      summary: `Cargó el ítem de inventario «${inventory.name}»`,
      detail: { fields: auditPick(inventory, ["name", "category", "kind", "quantity", "status", "sku"]) },
    });
    return Response.json({ inventory }, { status: 201 });
  }

  if (kind === "promoter") {
    const auth = await requireAdminContext("promoters.write");
    if (!auth.ok) return auth.response;
    if (typeof body.name !== "string") return jsonError("Name is required.", 400);
    const promoter = await db.promoter.create({
      data: {
        id: randomUUID(),
        organizationId: auth.context.organizationId,
        name: body.name.trim(),
        phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
        specialties: typeof body.specialties === "string" ? body.specialties.trim() : undefined,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Promoter",
      entityId: promoter.id,
      summary: `Cargó la promotora «${promoter.name}»`,
      detail: { fields: auditPick(promoter, ["name", "phone", "email", "specialties", "active"]) },
    });
    return Response.json({ promoter }, { status: 201 });
  }

  return jsonError("Invalid resource.", 400);
}
