import { randomUUID } from "node:crypto";
import { SUPPLIER_CATEGORIES, type SupplierCategoryValue } from "@/lib/admin-types";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { assertLive, trashErrorResponse } from "@/lib/server/trash";
import { archivedFieldsForActive } from "@/lib/server/trash-crm";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { FIELD_MESSAGES, emailValid, normalizeEmail, normalizePersonName, personNameValid } from "@/lib/field-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Directorio de proveedores de la empresa activa.
 *
 * - `GET` lista los proveedores con la cantidad de trabajos de cada uno.
 * - `POST` da de alta un proveedor (`suppliers.write`).
 * - `PATCH` edita los datos y el estado activo de un proveedor (`suppliers.write`).
 *
 * Todo se filtra por `organizationId`: un proveedor de otra empresa responde 404.
 */

const MAX = { name: 120, company: 120, phone: 30, email: 200, terms: 200, notes: 1000 } as const;

/** Campos que se auditan al crear o editar un proveedor. */
const SUPPLIER_AUDIT_FIELDS = ["name", "company", "phone", "email", "category", "paymentTerms", "notes", "active"] as const;

function isCategory(value: unknown): value is SupplierCategoryValue {
  return typeof value === "string" && (SUPPLIER_CATEGORIES as readonly string[]).includes(value);
}

/** Texto opcional: `undefined` no toca el campo, `null` o vacío lo limpia. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optionalEmail(value: unknown): string | null | undefined | false {
  const email = optionalText(value, MAX.email);
  if (email === undefined || email === null) return email;
  const normalized = normalizeEmail(email);
  return emailValid(normalized) ? normalized : false;
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const suppliers = await db.supplier.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { name: "asc" },
    take: 300,
    include: { _count: { select: { jobs: true } } },
  });
  return Response.json({ suppliers });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("suppliers.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Datos del proveedor inválidos.", 400);

  // Mensajes es-PY con las reglas del kit (issue #131): mismo texto en el front.
  const name = normalizePersonName(typeof body.name === "string" ? body.name : "");
  if (!personNameValid(name)) return jsonError(FIELD_MESSAGES.name, 400);
  if (body.category !== undefined && !isCategory(body.category)) return jsonError("El rubro del proveedor no es válido.", 400);
  const email = optionalEmail(body.email);
  if (email === false) return jsonError(FIELD_MESSAGES.email, 400);
  if (body.active !== undefined && typeof body.active !== "boolean") return jsonError("El estado del proveedor tiene que ser activo o inactivo.", 400);

  const supplier = await db.supplier.create({
    data: {
      id: randomUUID(),
      organizationId: auth.context.organizationId,
      name: name.slice(0, MAX.name),
      company: optionalText(body.company, MAX.company) ?? undefined,
      phone: optionalText(body.phone, MAX.phone) ?? undefined,
      email: email ?? undefined,
      category: isCategory(body.category) ? body.category : "OTHER",
      paymentTerms: optionalText(body.paymentTerms, MAX.terms) ?? undefined,
      notes: optionalText(body.notes, MAX.notes) ?? undefined,
      // El estado del alta se respeta (issue #131): antes se ignoraba y el
      // control quedaba muerto; sin valor, un proveedor nace activo.
      active: typeof body.active === "boolean" ? body.active : true,
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Supplier",
    entityId: supplier.id,
    summary: `Cargó el proveedor «${supplier.name}»`,
    detail: { fields: auditPick(supplier, SUPPLIER_AUDIT_FIELDS) },
  });
  return Response.json({ supplier }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("suppliers.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Datos del proveedor inválidos.", 400);
  if (typeof body.id !== "string") return jsonError("Falta el id del proveedor.", 400);

  const supplier = await db.supplier.findFirst({ where: { id: body.id, organizationId } });
  if (!supplier) return jsonError("Proveedor no encontrado.", 404);

  const name = body.name === undefined ? undefined : normalizePersonName(typeof body.name === "string" ? body.name : "");
  if (name !== undefined && !personNameValid(name)) return jsonError(FIELD_MESSAGES.name, 400);
  if (body.category !== undefined && !isCategory(body.category)) return jsonError("El rubro del proveedor no es válido.", 400);
  const email = optionalEmail(body.email);
  if (email === false) return jsonError(FIELD_MESSAGES.email, 400);
  if (body.active !== undefined && typeof body.active !== "boolean") return jsonError("El estado del proveedor tiene que ser activo o inactivo.", 400);

  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      // Papelera: un proveedor eliminado entre la lectura y la escritura da 404, no se edita.
      await assertLive("Supplier", supplier.id, organizationId, tx);
      return tx.supplier.update({
    where: { id: supplier.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(body.company !== undefined ? { company: optionalText(body.company, MAX.company) } : {}),
      ...(body.phone !== undefined ? { phone: optionalText(body.phone, MAX.phone) } : {}),
      ...(body.email !== undefined ? { email } : {}),
      ...(body.category !== undefined && isCategory(body.category) ? { category: body.category } : {}),
      ...(body.paymentTerms !== undefined ? { paymentTerms: optionalText(body.paymentTerms, MAX.terms) } : {}),
      ...(body.notes !== undefined ? { notes: optionalText(body.notes, MAX.notes) } : {}),
      // active y archivedAt van juntos (docs/PAPELERA.md): desactivar archiva y activar desarchiva.
      ...(body.active !== undefined ? { active: body.active as boolean, ...archivedFieldsForActive(body.active as boolean, supplier, auth.context.user.id) } : {}),
    },
      });
    });
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const changes = auditChanges(supplier, updated, SUPPLIER_AUDIT_FIELDS);
  if (changes) {
    await recordAudit({
      context: auth.context,
      action: "active" in changes ? "status" : "update",
      entity: "Supplier",
      entityId: supplier.id,
      summary: "active" in changes
        ? `${updated.active ? "Activó" : "Desactivó"} el proveedor «${updated.name}»`
        : `Editó el proveedor «${updated.name}»`,
      detail: { changes },
    });
  }
  return Response.json({ supplier: updated });
}
