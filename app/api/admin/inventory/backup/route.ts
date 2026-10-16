import { SignJWT, jwtVerify } from "jose";
import { requireAdminContext } from "@/lib/server/tenancy";
import { BackupError, BACKUP_EXCLUSIONS, BACKUP_LIMITS, exportInventoryBackup, readInventoryBackup, restoreInventoryBackup } from "@/lib/server/inventory-backup";
import { cuotaArchivosOk } from "@/lib/server/demo-sandbox";
import { db } from "@/lib/server/db";
import { sandboxVigente } from "@/lib/server/demo-sandbox";
import { createSandbox, purgeSandbox } from "@/lib/server/demo-sandboxes";
import { createSession, setDemoSessionCookie } from "@/lib/server/auth";
import { withIdempotency } from "@/lib/server/idempotency";
import { trustedIp } from "@/lib/server/trusted-ip";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { recordAudit } from "@/lib/server/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function signingKey() { const key = process.env.AUTH_SECRET || process.env.JWT_SECRET; if (!key) throw new BackupError("La confirmación de respaldo no está configurada.", 503); return new TextEncoder().encode(key); }
async function context() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") return { ok: false as const, response: Response.json({ error: "Sólo Propietario o Administrador puede respaldar y restaurar inventario." }, { status: 403 }) };
  return auth;
}
export async function GET() {
  const auth = await context(); if (!auth.ok) return auth.response;
  const limited = await rateLimit(`inventory-backup:${auth.context.organizationId}`, 5); if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  try {
    const bytes = await exportInventoryBackup(auth.context.organizationId);
    await recordAudit({ context: auth.context, action: "send", entity: "Organization", entityId: auth.context.organizationId, summary: "Descargó un respaldo de catálogo e inventario", detail: { fields: { bytes: bytes.byteLength, scope: "catalog-inventory" } } });
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="ledbox-catalogo-inventario-v1.zip"', "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { console.error("inventory-backup:", error instanceof Error ? error.message : "error"); return Response.json({ error: error instanceof BackupError ? error.message : "No se pudo procesar el respaldo; no se publicó una restauración parcial." }, { status: error instanceof BackupError ? error.status : 500 }); }
/** Enforce upload cap even for chunked requests without Content-Length. */
async function boundedForm(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new BackupError("Falta el archivo.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > BACKUP_LIMITS.archive + 65536) { await reader.cancel(); throw new BackupError("La carga supera 20 MiB.", 413); } chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
}
export async function POST(request: Request) {
  const auth = await context(); if (!auth.ok) return auth.response;
  // Restore is available only from an authenticated interactive demo, never from a real tenant.
  if (!auth.context.sandbox) return Response.json({ error: "Para ensayar la restauración, entrá a la demo y subí el respaldo allí. Tu empresa real no se modifica." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > BACKUP_LIMITS.archive + 65536) return Response.json({ error: "El archivo supera 20 MiB." }, { status: 413 });
  let allocatedSandbox: string | null = null; let committed = false;
  const limited = await rateLimit(`inventory-restore:${auth.context.organizationId}`, 10); if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  try {
    const form = await boundedForm(request); const file = form.get("backup");
    if (!(file instanceof File) || file.size > BACKUP_LIMITS.archive) throw new BackupError("Elegí un respaldo ZIP de hasta 20 MiB.");
    const pack = readInventoryBackup(new Uint8Array(await file.arrayBuffer()));
    const scope = { org: auth.context.organizationId, actor: auth.context.user.id, digest: pack.digest };
    if (form.get("action") === "preview") {
      const token = await new SignJWT(scope).setProtectedHeader({ alg: "HS256" }).setAudience("inventory-restore").setIssuedAt().setExpirationTime("10m").sign(signingKey());
      return Response.json({ token, summary: pack.summary, assetBytes: pack.assetBytes, externalReferences: pack.externalReferences, exclusions: BACKUP_EXCLUSIONS }, { headers: { "Cache-Control": "no-store" } });
    }
    if (form.get("action") !== "restore" || typeof form.get("token") !== "string") throw new BackupError("Revisá primero la vista previa.", 409);
    const token = String(form.get("token"));
    const { payload } = await jwtVerify(token, signingKey(), { audience: "inventory-restore", algorithms: ["HS256"] }).catch(() => { throw new BackupError("La vista previa venció; revisala nuevamente.", 409); });
    if (payload.org !== scope.org || payload.actor !== scope.actor || payload.digest !== scope.digest) throw new BackupError("El respaldo o la sesión cambió; revisá la vista previa.", 409);
    // Bind the full archive digest; only a server-created NEW sandbox can be a destination.
    const keyRequest = new Request(request.url, { headers: { "Idempotency-Key": pack.digest } });
    const response = await withIdempotency({ request: keyRequest, organizationId: scope.org, scope: "inventory-backup:restore", body: scope }, async tx => {
      const made = await createSandbox({ ip: trustedIp(request), emptyForInventoryRestore: true });
      if (!made.ok) return Response.json({ error: "No se pudo crear una demo vacía. Probá más tarde." }, { status: 429 });
      const sandbox = made.sandbox; allocatedSandbox = sandbox.organizationId;
      if (!await cuotaArchivosOk(sandbox.organizationId, pack.assetBytes)) throw new BackupError("Las imágenes exceden la cuota de archivos de la demo.", 413);
      await restoreInventoryBackup(tx, sandbox.organizationId, pack);
      return { status: 201, body: { sandbox, summary: pack.summary }, afterCommit: () => recordAudit({ context: auth.context, action: "restore", entity: "Organization", entityId: sandbox.organizationId, summary: "Ensayó un respaldo en una demo nueva", detail: { fields: { digest: pack.digest, summary: pack.summary } } }) };
    });
    if (response.ok) {
      committed = true;
      const { sandbox } = await response.clone().json();
      if (sandbox) {
        const live = await db.organization.findFirst({ where: { id: sandbox.organizationId, isDemo: true, demoParentId: { not: null } } });
        if (!live || !sandboxVigente(live)) throw new BackupError("La demo restaurada venció. Iniciá un ensayo nuevo desde otra demo.", 409);
        const session = await createSession(sandbox.user, sandbox.organizationId, { expiresAt: new Date(sandbox.expiresAt) }); await setDemoSessionCookie(session.jwt, new Date(sandbox.expiresAt)); }
    }
    return response;
  } catch (error) {
    if (allocatedSandbox && !committed) await purgeSandbox(allocatedSandbox).catch(() => undefined);
    return failure(error);
  }
}
