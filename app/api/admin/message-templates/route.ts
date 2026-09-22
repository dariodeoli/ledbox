import { randomUUID } from "node:crypto";
import { canWriteTemplateCategory } from "@/lib/admin-policy";
import { isMessageTemplateCategory, sanitizeMessageTemplateBody, validateMessageTemplate } from "@/lib/server/message-templates";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext, type AdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plantillas de mensajes de WhatsApp por contexto (issue #35).
 *
 * - `GET` lista las plantillas de la empresa activa (lectura para todos los
 *   roles, incluido VIEWER).
 * - `POST` da de alta una plantilla.
 * - `PATCH` edita título, cuerpo, categoría, orden o estado activo.
 * - `POST` con `{ action: "delete", id }` borra una plantilla (con confirmación
 *   propia en el panel).
 *
 * Permisos (server-side, misma regla que la UI): OWNER/ADMIN todas las
 * categorías; FINANCE solo `collection`; OPERATIONS solo `event`; VIEWER nada.
 * La empresa demo es de solo lectura. La categoría no se puede mover a una que
 * el rol no administre. El render no vive acá: `lib/server/message-templates.ts`.
 */

const MAX_TITLE = 120;
const DEFAULT_SORT_STEP = 10;

/** Campos que se auditan al crear o editar una plantilla. */
const TEMPLATE_AUDIT_FIELDS = ["title", "body", "category", "active", "sortOrder"] as const;

function forbidden(auth: AdminContext, category: string): Response | null {
  if (auth.demo) return jsonError("Modo demo: solo lectura", 403);
  if (!isMessageTemplateCategory(category) || !canWriteTemplateCategory(auth.role, category)) {
    return jsonError("Forbidden", 403);
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "P2002";
}

/** Campos editables normalizados del cuerpo del request (el resto se ignora). */
function templateData(body: Record<string, unknown>): {
  title?: string;
  body?: string;
  category?: string;
  active?: boolean;
  sortOrder?: number;
} {
  const data: { title?: string; body?: string; category?: string; active?: boolean; sortOrder?: number } = {};
  if (typeof body.title === "string") data.title = body.title.trim().slice(0, MAX_TITLE);
  if (typeof body.body === "string") data.body = sanitizeMessageTemplateBody(body.body);
  if (isMessageTemplateCategory(body.category)) data.category = body.category;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    data.sortOrder = Math.trunc(body.sortOrder);
  }
  return data;
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const templates = await db.messageTemplate.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    take: 300,
  });
  return Response.json({ templates });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { context } = auth;
  const body = (await readJson(request)) as Record<string, unknown>;

  if (body.action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la plantilla a borrar.", 400);
    const existing = await db.messageTemplate.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!existing) return jsonError("La plantilla no existe en esta empresa.", 404);
    const blocked = forbidden(context, existing.category);
    if (blocked) return blocked;
    await db.messageTemplate.delete({ where: { id: existing.id } });
    await recordAudit({
      context,
      action: "delete",
      entity: "MessageTemplate",
      entityId: existing.id,
      summary: `Borró la plantilla «${existing.title}» (${existing.category})`,
      detail: { before: auditPick(existing, TEMPLATE_AUDIT_FIELDS) },
    });
    return Response.json({ ok: true });
  }

  const data = templateData(body);
  const category = data.category;
  if (!isMessageTemplateCategory(category)) return jsonError("Elegí una categoría válida.", 400);
  const blocked = forbidden(context, category);
  if (blocked) return blocked;

  const title = data.title ?? "";
  const rawBody = typeof body.body === "string" ? body.body : "";
  const error = validateMessageTemplate({ title, body: sanitizeMessageTemplateBody(rawBody), category });
  if (error) return jsonError(error, 400);

  // Orden por defecto: al final de su categoría, en pasos de 10.
  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const last = await db.messageTemplate.findFirst({
      where: { organizationId: context.organizationId, category },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? 0) + DEFAULT_SORT_STEP;
  }

  try {
    const template = await db.messageTemplate.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        category,
        title,
        body: sanitizeMessageTemplateBody(rawBody),
        active: data.active ?? true,
        sortOrder,
        createdById: context.user.id,
        createdByName: context.user.name,
        updatedById: context.user.id,
        updatedByName: context.user.name,
      },
    });
    await recordAudit({
      context,
      action: "create",
      entity: "MessageTemplate",
      entityId: template.id,
      summary: `Cargó la plantilla «${template.title}» (${template.category})`,
      detail: { fields: auditPick(template, TEMPLATE_AUDIT_FIELDS) },
    });
    return Response.json({ template }, { status: 201 });
  } catch (caught) {
    if (isUniqueViolation(caught)) {
      return jsonError(`Ya existe una plantilla «${title}» en esta categoría.`, 409);
    }
    throw caught;
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { context } = auth;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (typeof body.id !== "string") return jsonError("Falta la plantilla.", 400);

  const existing = await db.messageTemplate.findFirst({ where: { id: body.id, organizationId: context.organizationId } });
  if (!existing) return jsonError("La plantilla no existe en esta empresa.", 404);

  const data = templateData(body);
  const category = data.category ?? existing.category;
  if (!isMessageTemplateCategory(category)) return jsonError("Elegí una categoría válida.", 400);
  // El rol debe poder administrar la categoría actual y la nueva (no se mueve
  // una plantilla a un contexto que el rol no maneja).
  const blockedCurrent = forbidden(context, existing.category);
  if (blockedCurrent) return blockedCurrent;
  const blockedNext = forbidden(context, category);
  if (blockedNext) return blockedNext;

  const title = data.title ?? existing.title;
  const nextBody = data.body ?? existing.body;
  const error = validateMessageTemplate({ title, body: nextBody, category });
  if (error) return jsonError(error, 400);

  let updated;
  try {
    updated = await db.messageTemplate.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title } : {}),
        ...(data.body !== undefined ? { body: nextBody } : {}),
        ...(data.category !== undefined ? { category } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedById: context.user.id,
        updatedByName: context.user.name,
      },
    });
  } catch (caught) {
    if (isUniqueViolation(caught)) {
      return jsonError(`Ya existe una plantilla «${title}» en esta categoría.`, 409);
    }
    throw caught;
  }

  const changes = auditChanges(existing, updated, TEMPLATE_AUDIT_FIELDS);
  if (changes) {
    await recordAudit({
      context,
      action: "active" in changes ? "status" : "update",
      entity: "MessageTemplate",
      entityId: existing.id,
      summary:
        "active" in changes
          ? `${updated.active ? "Activó" : "Desactivó"} la plantilla «${updated.title}»`
          : `Editó la plantilla «${updated.title}»`,
      detail: { changes },
    });
  }
  return Response.json({ template: updated });
}
