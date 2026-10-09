import { SignJWT, jwtVerify } from "jose";
import { Prisma } from "@prisma/client";
import type { AdminClientRucSnapshot } from "@/lib/admin-types";
import type { OwnDataResult } from "./ruc-owndata";

function secret() {
  const key = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!key) throw new Error("RUC confirmation unavailable");
  return new TextEncoder().encode(key);
}

export async function signRucConfirmation(result: OwnDataResult, organizationId: string, actorId: string) {
  const { ownData } = result;
  const snapshot: Omit<AdminClientRucSnapshot, "confirmedAt"> = {
    fullRuc: result.fullRuc, nameOfficial: ownData.nameOfficial, environment: ownData.environment,
    equivalenceRaw: ownData.equivalenceRaw, stateRaw: ownData.stateRaw,
    ...(ownData.sourcePartition !== undefined ? { sourcePartition: ownData.sourcePartition } : {}),
    provenance: ownData.provenance, lookedUpAt: new Date().toISOString(),
  };
  const confirmationToken = await new SignJWT({ organizationId, actorId, snapshot })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("ledbox:ruc").setAudience("ledbox:ruc-confirmation")
    .setIssuedAt().setExpirationTime("10m").sign(secret());
  return { confirmationToken, lookedUpAt: snapshot.lookedUpAt };
}

/** Solo datos firmados por servidor; no aceptar snapshots arbitrarios del navegador. */
export async function clientRucPatch(body: Record<string, unknown>, organizationId: string, actorId: string, before?: { ruc: string | null; legalName: string | null }) {
  if (body.rucSnapshot !== undefined) throw new Error("El snapshot de RUC sólo se guarda al confirmar una extracción.");
  if (body.rucConfirmationToken !== undefined) {
    if (body.confirmRuc !== true || typeof body.rucConfirmationToken !== "string" || body.rucConfirmationToken.length > 30000) throw new Error("Confirmá el resultado de la extracción de RUC.");
    let snapshot: Omit<AdminClientRucSnapshot, "confirmedAt">;
    try {
      const { payload } = await jwtVerify(body.rucConfirmationToken, secret(), { algorithms: ["HS256"], issuer: "ledbox:ruc", audience: "ledbox:ruc-confirmation" });
      if (payload.organizationId !== organizationId || payload.actorId !== actorId) throw new Error("Scope mismatch");
      snapshot = payload.snapshot as typeof snapshot;
      if (!snapshot?.fullRuc || !snapshot.nameOfficial || !snapshot.provenance) throw new Error("Invalid snapshot");
    } catch { throw new Error("La extracción venció o no corresponde a tu acceso/empresa. Consultá nuevamente o completá a mano."); }
    if ((body.ruc !== undefined && body.ruc !== snapshot.fullRuc) || (body.legalName !== undefined && body.legalName !== snapshot.nameOfficial)) throw new Error("El RUC o la razón social cambiaron desde la extracción. Consultá nuevamente o guardá manualmente sin confirmación.");
    return { ruc: snapshot.fullRuc, legalName: snapshot.nameOfficial, rucSnapshot: { ...snapshot, confirmedAt: new Date().toISOString() } as Prisma.InputJsonObject };
  }
  // Una edición fiscal manual invalida el snapshot, sin tocar fantasía/contactos.
  if ((body.ruc !== undefined && body.ruc !== before?.ruc) || (body.legalName !== undefined && body.legalName !== before?.legalName)) return { rucSnapshot: Prisma.DbNull };
  return {};
}
