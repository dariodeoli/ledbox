import { COVER_SPEC, isCoverKind } from "@/lib/appearance";
import { recordAudit } from "@/lib/server/audit";
import { uploadCover } from "@/lib/server/covers";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Portada de la tienda, un archivo por dispositivo (`desktop` 1920×600 y `mobile` 1080×1350).
 *
 * - `GET` la sirve **con sesión** (vista previa del panel).
 * - `POST` recibe `multipart/form-data` con `file` (JPG, PNG o WebP, hasta 2 MB). El tipo sale de
 *   los **magic bytes** —no del MIME declarado—: un archivo renombrado responde 400. Se
 *   comprime y redimensiona con sharp y queda en la base. En la demo y las sandboxes cuenta
 *   contra la cuota de archivos (`cuotaArchivosOk`).
 * - `DELETE` la quita (borrado explícito).
 */
function kindError(kind: string) {
  return jsonError(`Portada inválida: «${kind}». Usá «desktop» o «mobile».`, 400);
}

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { kind } = await params;
  if (!isCoverKind(kind)) return kindError(kind);
  const cover = await db.organizationCover.findUnique({
    where: { organizationId_kind: { organizationId: auth.context.organizationId, kind } },
    select: { mime: true, size: true, data: true },
  });
  if (!cover) return jsonError("La empresa todavía no subió esa portada.", 404);
  return new Response(new Uint8Array(cover.data), {
    status: 200,
    headers: { "Content-Type": cover.mime, "Content-Length": String(cover.size), "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { kind } = await params;
  if (!isCoverKind(kind)) return kindError(kind);
  return uploadCover(auth.context, kind, request);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, organization } = auth.context;
  const { kind } = await params;
  if (!isCoverKind(kind)) return kindError(kind);
  const removed = await db.organizationCover.deleteMany({ where: { organizationId, kind } });
  if (removed.count > 0) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: `Quitó la ${COVER_SPEC[kind].label.toLowerCase()} de «${organization.name}»`,
      detail: { fields: { [kind === "desktop" ? "portadaEscritorio" : "portadaCelular"]: "quitada" } },
    });
  }
  return Response.json({ kind, updatedAt: null, unchanged: removed.count === 0 });
}
