import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { PAGE_SIZE, likePattern, type TableParams } from "@/lib/platform/tablas";
import { orgReal, usuarioReal } from "@/lib/platform/sin-demo";

/**
 * Tabla de usuarios de plataforma (docs/SUPERADMIN.md §3). Solo usuarios con membresía activa
 * en una empresa real. Solo se piden columnas seguras: del PIN solo «tiene / no tiene» y de
 * la verificación solo «sí / no»; nunca `passwordHash`, `pinHash` ni tokens.
 */

export const USUARIO_SORTS = ["nombre", "correo", "ingreso", "actividad"] as const;

const ORDER_SQL: Record<(typeof USUARIO_SORTS)[number], Prisma.Sql> = {
  nombre: Prisma.sql`u."name"`,
  correo: Prisma.sql`u."email"`,
  ingreso: Prisma.sql`s."last"`,
  actividad: Prisma.sql`u."lastActiveAt"`,
};

export type UsuarioRow = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  hasPin: boolean;
  emailVerified: boolean;
  lastLogin: Date | null;
  lastActive: Date | null;
  companies: Array<{ org: string; role: string }>;
};

export type UsuariosPage = { rows: UsuarioRow[]; total: number; page: number; pageSize: number };

type RawRow = {
  id: string; name: string; email: string; active: boolean; pin: boolean; verificado: boolean;
  ingreso: Date | null; actividad: Date | null; empresas: Array<{ org: string; role: string }> | null;
};

function where(params: TableParams): Prisma.Sql {
  const parts: Prisma.Sql[] = [usuarioReal("u", "id")];
  if (params.q) {
    const like = likePattern(params.q);
    parts.push(Prisma.sql`(u."name" ILIKE ${like} ESCAPE '\\' OR u."email" ILIKE ${like} ESCAPE '\\')`);
  }
  if (params.filters.activa === "si") parts.push(Prisma.sql`u."active" = true`);
  if (params.filters.activa === "no") parts.push(Prisma.sql`u."active" = false`);
  if (params.filters.verificado === "si") parts.push(Prisma.sql`u."emailVerifiedAt" IS NOT NULL`);
  if (params.filters.verificado === "no") parts.push(Prisma.sql`u."emailVerifiedAt" IS NULL`);
  if (params.filters.pin === "si") parts.push(Prisma.sql`u."pinHash" IS NOT NULL`);
  if (params.filters.pin === "no") parts.push(Prisma.sql`u."pinHash" IS NULL`);
  return Prisma.join(parts, " AND ");
}

export async function loadUsuarios(params: TableParams, options: { pageSize?: number } = {}): Promise<UsuariosPage> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const key = (USUARIO_SORTS as readonly string[]).includes(params.sort) ? (params.sort as keyof typeof ORDER_SQL) : "nombre";
  const direction = params.dir === "desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");
  const offset = (params.page - 1) * pageSize;
  const cond = where(params);
  const [rows, count] = await Promise.all([
    db.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT u."id", u."name", u."email", u."active",
             (u."pinHash" IS NOT NULL) AS pin, (u."emailVerifiedAt" IS NOT NULL) AS verificado,
             s."last" AS ingreso, u."lastActiveAt" AS actividad, mm.empresas
      FROM "AdminUser" u
      LEFT JOIN (SELECT "userId", MAX("createdAt") AS "last" FROM "AdminSession" GROUP BY "userId") s ON s."userId" = u."id"
      LEFT JOIN (
        SELECT m."adminUserId", json_agg(json_build_object('org', o."name", 'role', m."role"::text) ORDER BY o."name") AS empresas
        FROM "AdminMembership" m JOIN "Organization" o ON o."id" = m."organizationId"
        WHERE m."active" = true AND ${orgReal("m")}
        GROUP BY m."adminUserId") mm ON mm."adminUserId" = u."id"
      WHERE ${cond}
      ORDER BY ${ORDER_SQL[key]} ${direction} NULLS LAST, u."id" ASC
      LIMIT ${pageSize} OFFSET ${offset}`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "AdminUser" u WHERE ${cond} GROUP BY (u."id" IS NOT NULL)`),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, active: r.active, hasPin: r.pin, emailVerified: r.verificado,
      lastLogin: r.ingreso, lastActive: r.actividad, companies: r.empresas ?? [],
    })),
    total: count[0]?.n ?? 0,
    page: params.page,
    pageSize,
  };
}

export type UsuarioDetail = UsuarioRow & {
  createdAt: Date;
  memberships: Array<{ org: string; role: string; active: boolean }>;
};

/** Detalle de un usuario REAL; la demo o un id inexistente devuelve `null`. */
export async function loadUsuarioDetail(id: string): Promise<UsuarioDetail | null> {
  const found = await db.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
    SELECT u."id", u."createdAt" FROM "AdminUser" u WHERE u."id" = ${id} AND ${usuarioReal("u", "id")}`);
  if (!found[0]) return null;
  const [row, memberships] = await Promise.all([
    loadUsuarioRow(id),
    db.$queryRaw<Array<{ org: string; role: string; active: boolean }>>(Prisma.sql`
      SELECT o."name" AS org, m."role"::text AS role, m."active" AS active
      FROM "AdminMembership" m JOIN "Organization" o ON o."id" = m."organizationId"
      WHERE m."adminUserId" = ${id} AND ${orgReal("m")}
      ORDER BY o."name"`),
  ]);
  if (!row) return null;
  return { ...row, createdAt: found[0].createdAt, memberships };
}

async function loadUsuarioRow(id: string): Promise<UsuarioRow | null> {
  const rows = await db.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT u."id", u."name", u."email", u."active",
           (u."pinHash" IS NOT NULL) AS pin, (u."emailVerifiedAt" IS NOT NULL) AS verificado,
           s."last" AS ingreso, u."lastActiveAt" AS actividad, NULL::json AS empresas
    FROM "AdminUser" u
    LEFT JOIN (SELECT "userId", MAX("createdAt") AS "last" FROM "AdminSession" WHERE "userId" = ${id} GROUP BY "userId") s ON s."userId" = u."id"
    WHERE u."id" = ${id} AND ${usuarioReal("u", "id")}`);
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, email: r.email, active: r.active, hasPin: r.pin, emailVerified: r.verificado, lastLogin: r.ingreso, lastActive: r.actividad, companies: [] };
}
