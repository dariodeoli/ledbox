import { randomUUID } from "node:crypto";
import { identityImageExtension } from "@/lib/admin-types";
import { recordAudit } from "@/lib/server/audit";
import { parseImageUpload } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Logo del cliente (issue #36), con el mismo pipeline de imágenes del panel
 * (`parseImageUpload`: base64 ya recortado y comprimido por el navegador,
 * validado por **magic bytes** y con tope de 1 MB).
 *
 * - `GET` sirve el binario **solo con sesión**: un cliente de otra empresa no
 *   existe para esta consulta (404), igual que uno sin logo subido. Se cachea
 *   únicamente en el navegador del panel (`private`) con la versión en la query
 *   (`?v=<updatedAt>`) que arma `clientLogoUrl`.
 * - `POST` sube o reemplaza el logo (`clients.write`).
 * - `DELETE` lo quita (borrado explícito); vuelve el monograma de iniciales.
 */

/** Cliente de la empresa activa con el nombre para el archivo servido. */
async function activeClient(organizationId: string, id: string) {
  return db.client.findFirst({ where: { id, organizationId }, select: { id: true, name: true, company: true } });
}

/** Nombre de archivo legible del logo (`logo-tigo-paraguay.png`). */
function logoFilename(client: { name: string; company: string | null }, mime: string): string {
  const source = client.company?.trim() || client.name;
  const slug = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `logo-${slug || "cliente"}.${identityImageExtension(mime)}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) return jsonError("No encontramos ese logo del cliente.", 404);

  const client = await activeClient(auth.context.organizationId, id);
  if (!client) return jsonError("No encontramos ese logo del cliente.", 404);

  const logo = await db.clientLogo.findUnique({
    where: { clientId: client.id },
    select: { mime: true, size: true, data: true },
  });
  if (!logo) return jsonError("El cliente todavía no tiene logo.", 404);

  return new Response(new Uint8Array(logo.data), {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.size),
      "Content-Disposition": `inline; filename="${logoFilename(client, logo.mime)}"`,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const client = await activeClient(organizationId, id);
  if (!client) return jsonError("No encontramos ese cliente en la empresa activa.", 404);

  const parsed = parseImageUpload(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const { bytes, mime, width, height } = parsed.image;

  const logo = await db.clientLogo.upsert({
    where: { clientId: client.id },
    create: { id: randomUUID(), clientId: client.id, mime, size: bytes.byteLength, width, height, data: bytes },
    update: { mime, size: bytes.byteLength, width, height, data: bytes },
    select: { updatedAt: true },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Client",
    entityId: client.id,
    summary: `Subió el logo de «${client.name}»`,
    detail: { fields: { logo: "subido", mime, size: bytes.byteLength } },
  });

  return Response.json({ updatedAt: logo.updatedAt.toISOString() });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const client = await activeClient(organizationId, id);
  if (!client) return jsonError("No encontramos ese cliente en la empresa activa.", 404);

  const removed = await db.clientLogo.deleteMany({ where: { clientId: client.id } });
  if (removed.count > 0) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Client",
      entityId: client.id,
      summary: `Quitó el logo de «${client.name}»`,
      detail: { fields: { logo: "quitado" } },
    });
  }
  return Response.json({ updatedAt: null, unchanged: removed.count === 0 });
}
