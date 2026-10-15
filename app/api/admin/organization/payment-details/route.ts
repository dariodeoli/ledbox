import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/POST /api/admin/organization/payment-details` (issue #14): datos de pago
 * de la empresa activa —banco, titular, RUC, cuenta y alias— que el portal del
 * cliente muestra recién con el presupuesto aprobado y la hoja imprimible
 * repite en el mismo estado.
 *
 * Solo OWNER y ADMIN los ven y los editan; el resto de los roles responde 403.
 * Se guardan como JSON `{ bank, holder, ruc, account, alias }` con los campos
 * vacíos afuera; sin ningún dato la empresa queda sin bloque de pago (el portal
 * no inventa una cuenta).
 */

const FIELDS = [
  { key: "bank", label: "Banco", max: 80 },
  { key: "holder", label: "Titular", max: 120 },
  { key: "ruc", label: "RUC", max: 20 },
  { key: "account", label: "Cuenta", max: 40 },
  { key: "alias", label: "Alias", max: 60 },
] as const;

/** Tipo de cuenta y moneda: listas cerradas (se guardan junto a lo demás en el mismo JSON). */
const ACCOUNT_TYPES = ["CORRIENTE", "AHORRO"] as const;
const CURRENCIES = ["PYG", "USD", "BRL", "EUR"] as const;
const ENUM_FIELDS = [
  { key: "accountType", label: "Tipo de cuenta", options: ACCOUNT_TYPES as readonly string[] },
  { key: "currency", label: "Moneda", options: CURRENCIES as readonly string[] },
] as const;
const AUDIT_KEYS = [...FIELDS.map((field) => field.key), ...ENUM_FIELDS.map((field) => field.key)];

type PaymentDetails = {
  bank: string | null;
  holder: string | null;
  ruc: string | null;
  account: string | null;
  alias: string | null;
  /** CORRIENTE (cuenta corriente) o AHORRO (caja de ahorro). */
  accountType: string | null;
  /** PYG, USD, BRL o EUR. */
  currency: string | null;
};

function parseDetails(value: unknown): PaymentDetails {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const details = { bank: null, holder: null, ruc: null, account: null, alias: null, accountType: null, currency: null } as PaymentDetails;
  for (const field of FIELDS) {
    const raw = record[field.key];
    const text = typeof raw === "string" ? raw.trim() : "";
    details[field.key] = text ? text.slice(0, field.max) : null;
  }
  for (const field of ENUM_FIELDS) {
    const raw = typeof record[field.key] === "string" ? (record[field.key] as string).trim().toUpperCase() : "";
    details[field.key] = field.options.includes(raw) ? raw : null;
  }
  return details;
}

function hasAny(details: PaymentDetails): boolean {
  return FIELDS.some((field) => Boolean(details[field.key]));
}

function ownerOrAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  if (!ownerOrAdmin(auth.context.role)) return jsonError("Forbidden", 403);
  const organization = await db.organization.findUnique({
    where: { id: auth.context.organizationId },
    select: { paymentDetails: true },
  });
  return Response.json({ paymentDetails: parseDetails(organization?.paymentDetails) });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  if (!ownerOrAdmin(auth.context.role)) return jsonError("Forbidden", 403);
  const { organizationId, organization } = auth.context;

  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Los datos de pago deben ser un objeto JSON.", 400);
  const record = body;
  for (const field of FIELDS) {
    const raw = record[field.key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") return jsonError(`El campo ${field.label} debe ser texto.`, 400);
    if (typeof raw === "string" && raw.trim().length > field.max) {
      return jsonError(`${field.label} no puede superar los ${field.max} caracteres.`, 400);
    }
  }

  for (const field of ENUM_FIELDS) {
    const raw = record[field.key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" || !field.options.includes(raw.trim().toUpperCase())) {
      return jsonError(`${field.label}: elegí ${field.options.join(", ")}.`, 400);
    }
  }

  const before = parseDetails(
    (await db.organization.findUnique({ where: { id: organizationId }, select: { paymentDetails: true } }))?.paymentDetails,
  );
  const after = parseDetails(record);
  const changes = auditChanges(
    { ...before },
    { ...after },
    AUDIT_KEYS,
  );
  if (!changes) return Response.json({ paymentDetails: before, unchanged: true });

  await db.organization.update({
    where: { id: organizationId },
    data: { paymentDetails: hasAny(after) ? (after as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Organization",
    entityId: organizationId,
    summary: `Actualizó los datos de pago de «${organization.name}» para el portal y la hoja impresa`,
    detail: changes ? { changes } : { fields: { paymentDetails: "sin datos" } },
  });
  return Response.json({ paymentDetails: after });
}
