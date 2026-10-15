import { Prisma } from "@prisma/client";

/**
 * Filtro único de la demo (docs/SUPERADMIN.md §3). Toda consulta de
 * `lib/platform/queries/*` lo usa: la empresa demo nunca entra en los números reales
 * y se muestra aparte como contador. `alias` y `column` son identificadores fijos del
 * código (nunca entrada del usuario) y se validan antes de armar el SQL.
 */

/**
 * «Demo» = `Organization.isDemo` (la vitrina `demo` y las sandboxes por visitante, docs/DEMO-INTERACTIVA.md §4).
 * El `slug = 'demo'` se mantiene como red de seguridad: si la vitrina se recrea antes de que
 * `ensureDemoData` marque `isDemo`, igual queda fuera de los números reales.
 */
const ES_DEMO = Prisma.raw(`("isDemo" = true OR "slug" = 'demo')`);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(value: string): Prisma.Sql {
  if (!IDENT.test(value)) throw new Error(`Identificador SQL inválido: ${value}`);
  return Prisma.raw(`"${value}"`);
}

/** Filas de una empresa real: `alias."organizationId" NOT IN (demo)`. */
export function orgReal(alias: string, column = "organizationId"): Prisma.Sql {
  return Prisma.sql`${ident(alias)}.${ident(column)} NOT IN (SELECT "id" FROM "Organization" WHERE ${ES_DEMO})`;
}

/** Filas de la empresa demo (para su contador aparte). */
export function orgDemo(alias: string, column = "organizationId"): Prisma.Sql {
  return Prisma.sql`${ident(alias)}.${ident(column)} IN (SELECT "id" FROM "Organization" WHERE ${ES_DEMO})`;
}

/** Usuario real: tiene membresía activa en alguna empresa con `isDemo = false` (ni vitrina ni sandbox). */
export function usuarioReal(alias: string, column = "userId"): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "AdminMembership" m
    JOIN "Organization" o ON o."id" = m."organizationId"
    WHERE m."adminUserId" = ${ident(alias)}.${ident(column)} AND m."active" = true AND o."isDemo" = false AND o."slug" <> 'demo'
  )`;
}
