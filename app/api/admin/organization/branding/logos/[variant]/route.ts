import { randomUUID } from "node:crypto";
import { identityImageExtension, isLogoVariant, type LogoVariant } from "@/lib/admin-types";
import { logoVariantLabel } from "@/lib/admin-format";
import { recordAudit } from "@/lib/server/audit";
import { parseImageUpload } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Logo de la empresa por tema (issue #22): una variante por vez (`light` para
 * fondos oscuros, `dark` para fondos claros).
 *
 * - `GET` sirve el binario **con sesión**: lo ve todo el panel (el chip de la
 *   empresa lo dibuja en el shell), pero nunca el sitio público.
 * - `POST` sube o reemplaza la variante (OWNER/ADMIN, capacidad `org.manage`):
 *   `{ data, mime?, width?, height? }` ya recortado y comprimido por el
 *   navegador, validado por magic bytes y con tope de 1 MB.
 * - `DELETE` la quita (borrado explícito) y vuelve el monograma `LB`.
 */

function variantError(variant: string) {
  return jsonError(`Variante de logo inválida: «${variant}». Usá «light» o «dark».`, 400);
}

/** Campo de auditoría de la variante (`logoLight`/`logoDark`, con su etiqueta). */
function variantField(variant: LogoVariant) {
  return variant === "light" ? "logoLight" : "logoDark";
}

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { variant } = await params;
  if (!isLogoVariant(variant)) return variantError(variant);

  const logo = await db.organizationLogo.findUnique({
    where: { organizationId_variant: { organizationId: auth.context.organizationId, variant } },
    select: { mime: true, size: true, data: true },
  });
  if (!logo) return jsonError("La empresa todavía no subió ese logo.", 404);

  return new Response(new Uint8Array(logo.data), {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.size),
      "Content-Disposition": `inline; filename="logo-${variant}.${identityImageExtension(logo.mime)}"`,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, organization } = auth.context;
  const { variant } = await params;
  if (!isLogoVariant(variant)) return variantError(variant);

  const parsed = parseImageUpload(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const { bytes, mime, width, height } = parsed.image;

  const logo = await db.organizationLogo.upsert({
    where: { organizationId_variant: { organizationId, variant } },
    create: { id: randomUUID(), organizationId, variant, mime, size: bytes.byteLength, width, height, data: bytes },
    update: { mime, size: bytes.byteLength, width, height, data: bytes },
    select: { updatedAt: true },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Organization",
    entityId: organizationId,
    summary: `Subió el ${logoVariantLabel(variant).toLowerCase()} de «${organization.name}»`,
    detail: { fields: { [variantField(variant)]: "subido", mime, size: bytes.byteLength } },
  });

  return Response.json({ variant, updatedAt: logo.updatedAt.toISOString() });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, organization } = auth.context;
  const { variant } = await params;
  if (!isLogoVariant(variant)) return variantError(variant);

  const removed = await db.organizationLogo.deleteMany({ where: { organizationId, variant } });
  if (removed.count > 0) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: `Quitó el ${logoVariantLabel(variant).toLowerCase()} de «${organization.name}»`,
      detail: { fields: { [variantField(variant)]: "quitado" } },
    });
  }
  return Response.json({ variant, updatedAt: null, unchanged: removed.count === 0 });
}
