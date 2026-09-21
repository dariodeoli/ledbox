import { randomUUID } from "node:crypto";
import { SUPPLIER_CATEGORIES, type SupplierCategoryValue } from "@/lib/admin-types";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : false;
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
  const body = await readJson(request) as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) return jsonError("Supplier name is required.", 400);
  if (body.category !== undefined && !isCategory(body.category)) return jsonError("Invalid supplier category.", 400);
  const email = optionalEmail(body.email);
  if (email === false) return jsonError("Invalid email address.", 400);

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
    },
  });
  return Response.json({ supplier }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("suppliers.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.id !== "string") return jsonError("Supplier id is required.", 400);

  const supplier = await db.supplier.findFirst({ where: { id: body.id, organizationId }, select: { id: true } });
  if (!supplier) return jsonError("Supplier not found.", 404);

  const name = optionalText(body.name, MAX.name);
  if (name === null) return jsonError("Supplier name cannot be empty.", 400);
  if (body.category !== undefined && !isCategory(body.category)) return jsonError("Invalid supplier category.", 400);
  const email = optionalEmail(body.email);
  if (email === false) return jsonError("Invalid email address.", 400);
  if (body.active !== undefined && typeof body.active !== "boolean") return jsonError("Active must be a boolean.", 400);

  const updated = await db.supplier.update({
    where: { id: supplier.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(body.company !== undefined ? { company: optionalText(body.company, MAX.company) } : {}),
      ...(body.phone !== undefined ? { phone: optionalText(body.phone, MAX.phone) } : {}),
      ...(body.email !== undefined ? { email } : {}),
      ...(body.category !== undefined && isCategory(body.category) ? { category: body.category } : {}),
      ...(body.paymentTerms !== undefined ? { paymentTerms: optionalText(body.paymentTerms, MAX.terms) } : {}),
      ...(body.notes !== undefined ? { notes: optionalText(body.notes, MAX.notes) } : {}),
      ...(body.active !== undefined ? { active: body.active as boolean } : {}),
    },
  });
  return Response.json({ supplier: updated });
}
