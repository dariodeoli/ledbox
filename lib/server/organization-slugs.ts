import { Prisma } from "@prisma/client";
import { db } from "./db";

export class OrganizationSlugTaken extends Error {
  constructor() { super("Ese identificador ya pertenece a otra empresa o está reservado por su historial."); }
}

/** Todos los escritores toman este lock ANTES del lock de Organization. */
export async function lockOrganizationSlugNamespace(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(135261)`;
}

/** Conserva namespace aun si se elimina una empresa; sólo el mismo ID puede recuperarlo. */
export async function assertOrganizationSlugAvailable(tx: Prisma.TransactionClient, slug: string, organizationId: string) {
  await lockOrganizationSlugNamespace(tx);
  const owners = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
    SELECT "organizationId" FROM "OrganizationSlug" WHERE lower("slug") = lower(${slug})
    UNION SELECT "id" AS "organizationId" FROM "Organization" WHERE lower("slug") = lower(${slug})`);
  if (owners.some(owner => owner.organizationId !== organizationId)) throw new OrganizationSlugTaken();
  // Un slug default configurado pero aún ausente no se puede apropiar y cambiar el fallback.
  const defaultSlug = (process.env.DEFAULT_ORGANIZATION_SLUG || "ledbox").trim().toLowerCase();
  if (!owners.length && slug.toLowerCase() === defaultSlug) {
    const fallback = await tx.organization.findFirst({ where: { active: true, isDemo: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (fallback && fallback.id !== organizationId) throw new OrganizationSlugTaken();
  }

}

export async function claimOrganizationSlug(tx: Prisma.TransactionClient, slug: string, organizationId: string) {
  await assertOrganizationSlugAvailable(tx, slug, organizationId);
  await tx.$executeRaw(Prisma.sql`INSERT INTO "OrganizationSlug" ("slug", "organizationId")
    VALUES (${slug}, ${organizationId}) ON CONFLICT ("slug") DO NOTHING`);
}

/** El alias sólo identifica la empresa; cada consumidor conserva sus filtros de acceso. */
export async function resolveOrganizationSlugId(slug: string, client: Prisma.TransactionClient | typeof db = db): Promise<string | null> {
  const key = slug.trim();
  if (!key || key.length > 80) return null;
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Organization" WHERE lower("slug") = lower(${key})
    UNION SELECT o."id" FROM "OrganizationSlug" s JOIN "Organization" o ON o."id" = s."organizationId"
    WHERE lower(s."slug") = lower(${key})`);
  // Historia ambigua preexistente falla cerrada: nunca elegir arbitrariamente otro tenant.
  return rows.length === 1 ? rows[0].id : null;
}

export async function loadOrganizationSlugAliases(organizationId: string) {
  return db.$queryRaw<Array<{ slug: string }>>(Prisma.sql`
    SELECT s."slug" FROM "OrganizationSlug" s JOIN "Organization" o ON o."id" = s."organizationId"
    WHERE s."organizationId" = ${organizationId} AND s."slug" <> o."slug" ORDER BY s."createdAt", s."slug"`);
}

/** Un default conocido inactivo/eliminado no habilita desviar leads a otra empresa. */
export async function organizationSlugHasHistory(slug: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ slug: string }>>(Prisma.sql`
    SELECT "slug" FROM "OrganizationSlug" WHERE lower("slug") = lower(${slug.trim()})
    UNION SELECT "slug" FROM "Organization" WHERE lower("slug") = lower(${slug.trim()})`);
  return rows.length > 0;
}
