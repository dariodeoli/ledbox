import { organizationSlugHasHistory, resolveOrganizationSlugId } from "./organization-slugs";
import type { AdminRole } from "@prisma/client";
import { headers } from "next/headers";
import { parseBearerToken } from "@/lib/api-tokens";
import { getAuthenticatedAdmin, onSandboxHost, type AuthenticatedAdmin, type PublicAdminUser } from "./auth";
import { touchApiToken, verifyApiToken } from "./api-tokens";
import { DEMO_ORGANIZATION_SLUG, isDemoOrganizationSlug } from "./demo-data";
import { DEMO_SANDBOX_ENABLED, isSandboxOrg, SANDBOX_DENIED_MESSAGE } from "./demo-sandbox";
import { db } from "./db";
import { jsonError } from "./http";
import { ensureOrganizationPlan } from "./plan-limits";
import { roleCan, type AdminCapability } from "./permissions";
import { rateLimit, rateLimitResponse } from "./rate-limit";
import { trackAdminActivity } from "@/lib/platform/activity";

/**
 * Capa de tenancy del panel: resuelve la sesión, la empresa activa y la
 * membresía del usuario, y es la única puerta de entrada de `app/api/admin/*`.
 *
 * - Sin sesión → 401.
 * - Sesión bloqueada por PIN (issue #21) → 423, salvo `allowLocked`.
 * - Con sesión pero sin membresía activa (o sin empresa activa) → 403.
 * - Con membresía pero sin la capacidad pedida → 403.
 * - La organización demo (issue #14) es de solo lectura: toda capacidad de
 *   escritura responde 403 «Modo demo: solo lectura», sin importar el rol.
 *
 * Toda lectura se filtra por `context.organizationId` y toda alta lo setea; así
 * ninguna consulta puede cruzar datos entre empresas.
 */

export type AdminContext = {
  /** Usuario con el rol efectivo de la empresa activa (no el rol global). */
  user: PublicAdminUser;
  session: AuthenticatedAdmin["session"];
  organization: {
    id: string;
    name: string;
    slug: string;
    /** Plan comercial vigente (issue #42); `null` se resuelve con el por defecto. */
    planId: string | null;
  };
  role: AdminRole;
  organizationId: string;
  /** La empresa activa es la vitrina de la demo pública: el panel va en modo solo lectura. */
  demo: boolean;
  /**
   * La empresa activa es una sandbox por visitante (docs/DEMO-INTERACTIVA.md): escribe, pero toda
   * salida hacia afuera queda cortada (`lib/server/demo-sandbox.ts`).
   */
  sandbox: boolean;
};

/** Opciones de `requireAdminContext`. */
export type RequireAdminOptions = {
  allowLocked?: boolean;
  /** `"deny"`: la ruta es 403 «En la demo esto está desactivado» en una sandbox (API keys, usuarios, clave, PIN, plan…). */
  sandbox?: "deny";
};

export type AdminContextResult = { ok: true; context: AdminContext } | { ok: false; response: Response };

/** `isSandboxOrg` sin lanzar: si falla se registra y se devuelve `null` (el llamador responde 503, nunca trata la empresa como real). */
async function sandboxFlag(organizationId: string): Promise<boolean | null> {
  try {
    return await isSandboxOrg(organizationId);
  } catch (error) {
    console.error("tenancy: no se pudo verificar si la empresa es una sandbox", error);
    return null;
  }
}

const organizationSelect = { id: true, name: true, slug: true, planId: true } as const;

async function findMembership(adminUserId: string, organizationId: string | null) {
  const base = { adminUserId, active: true, organization: { active: true } } as const;
  if (organizationId) {
    const current = await db.adminMembership.findFirst({
      where: { ...base, organizationId },
      include: { organization: { select: organizationSelect } },
    });
    if (current) return current;
  }
  // Sin empresa activa (o si la membresía se desactivó) se usa la predeterminada y, si no vale, la primera.
  const preferred = await validDefaultOrganizationId(adminUserId);
  if (preferred) {
    const byDefault = await db.adminMembership.findFirst({
      where: { ...base, organizationId: preferred },
      include: { organization: { select: organizationSelect } },
    });
    if (byDefault) return byDefault;
  }
  return db.adminMembership.findFirst({
    where: base,
    orderBy: { createdAt: "asc" },
    include: { organization: { select: organizationSelect } },
  });
}

/**
 * Resuelve la sesión, la empresa activa y la membresía. Por defecto una sesión
 * **bloqueada** (PIN, issue #21) no entrega datos ni permite mutar: responde 423
 * y solo los endpoints de sesión/PIN pueden operar con `allowLocked`.
 *
 * Si el request trae `Authorization: Bearer <token>` (issue #69), la API key es
 * el actor: resuelve a la empresa del token con su rol acotado, respeta la misma
 * matriz de capacidades y la demo sigue siendo de solo lectura. La cookie sigue
 * siendo el camino normal del panel cuando no hay Bearer.
 */
export async function requireAdminContext(
  capability?: AdminCapability,
  options?: RequireAdminOptions,
): Promise<AdminContextResult> {
  const bearer = parseBearerToken((await headers()).get("authorization"));
  if (bearer) return requireApiTokenContext(bearer, capability, options);

  const auth = await getAuthenticatedAdmin();
  if (!auth) return { ok: false, response: jsonError("Unauthorized", 401) };

  // Bloqueo rápido del panel (issue #21): mientras la sesión está bloqueada no
  // sale ningún dato; el desbloqueo (PIN o login completo) es lo único habilitado.
  if (auth.session.lockedAt && !options?.allowLocked) {
    return { ok: false, response: jsonError("El panel está bloqueado. Desbloquealo con tu PIN.", 423) };
  }

  const membership = await findMembership(auth.user.id, auth.session.activeOrganizationId);
  if (!membership) return { ok: false, response: jsonError("Forbidden", 403) };

  if (auth.session.activeOrganizationId !== membership.organizationId) {
    await db.adminSession.update({
      where: { id: auth.session.id },
      data: { activeOrganizationId: membership.organizationId },
    });
    auth.session.activeOrganizationId = membership.organizationId;
  }

  const role = membership.role;
  const demo = isDemoOrganizationSlug(membership.organization.slug);
  const sandbox = !demo && (await sandboxFlag(membership.organizationId));
  if (sandbox === null) return { ok: false, response: jsonError("No pudimos verificar la empresa. Probá de nuevo.", 503) };
  // 401 cruzado (docs/DEMO-INTERACTIVA.md §2): una empresa de la demo solo responde en el host demo y una real, fuera de él.
  if (DEMO_SANDBOX_ENABLED && (demo || sandbox) !== (await onSandboxHost())) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }
  // La empresa sin plan recibe el por defecto una sola vez (issue #42): así los
  // límites se aplican desde el primer request y no queda una empresa sin tope
  // por olvido. Best-effort: `ensureOrganizationPlan` nunca rompe el request.
  if (!membership.organization.planId) {
    membership.organization.planId = await ensureOrganizationPlan(membership.organizationId);
  }
  // La demo es de solo lectura por contrato: el rol de la membresía es VIEWER,
  // pero además acá se corta cualquier capacidad de escritura (así el error es
  // explícito y no depende de que el rol siga siendo VIEWER).
  if (capability && demo) {
    return { ok: false, response: jsonError("Modo demo: solo lectura", 403) };
  }
  if (sandbox && options?.sandbox === "deny") {
    return { ok: false, response: jsonError(SANDBOX_DENIED_MESSAGE, 403) };
  }
  if (capability && !roleCan(role, capability)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  // Registro de actividad (docs/SUPERADMIN.md §3): solo la rama de cookie, nunca la demo
  // ni la API key; va en `after()` y no puede romper ni demorar la respuesta.
  // Las rutas de PIN (`allowLocked`) con la sesión bloqueada no cuentan como uso del panel.
  if (!auth.session.lockedAt) trackAdminActivity({ userId: auth.user.id, organizationId: membership.organizationId, lastActiveAt: auth.lastActiveAt, demo: demo || sandbox });

  return {
    ok: true,
    context: {
      user: { id: auth.user.id, name: auth.user.name, email: auth.user.email, role },
      session: auth.session,
      organization: membership.organization,
      role,
      organizationId: membership.organizationId,
      demo,
      sandbox,
    },
  };
}

/**
 * Actor por API key (issue #69): resuelve el Bearer a la empresa del token con
 * su rol acotado. Mismas reglas que la sesión —capacidad, demo de solo lectura—
 * y rate-limit por clave (misma ventana de 15 minutos que el resto del API).
 * El token inválido/revocado no distingue el motivo en HTTP (401 genérico).
 */
const API_TOKEN_RATE_LIMIT = 300;

async function requireApiTokenContext(token: string, capability?: AdminCapability, options?: RequireAdminOptions): Promise<AdminContextResult> {
  const verified = await verifyApiToken(token);
  if (!verified.ok) return { ok: false, response: jsonError("Unauthorized", 401) };
  const apiToken = verified.token;

  const limited = await rateLimit(`api-token:${apiToken.id}`, API_TOKEN_RATE_LIMIT);
  if (!limited.allowed) return { ok: false, response: rateLimitResponse(limited.retryAfter) };

  const demo = isDemoOrganizationSlug(apiToken.organization.slug);
  const sandbox = !demo && (await sandboxFlag(apiToken.organization.id));
  if (sandbox === null) return { ok: false, response: jsonError("No pudimos verificar la empresa. Probá de nuevo.", 503) };
  if (capability && demo) {
    return { ok: false, response: jsonError("Modo demo: solo lectura", 403) };
  }
  if (sandbox && options?.sandbox === "deny") {
    return { ok: false, response: jsonError(SANDBOX_DENIED_MESSAGE, 403) };
  }
  if (capability && !roleCan(apiToken.role, capability)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  if (!apiToken.organization.planId) {
    apiToken.organization.planId = await ensureOrganizationPlan(apiToken.organization.id);
  }
  await touchApiToken(apiToken);

  return {
    ok: true,
    context: {
      // El actor de auditoría deja la traza de la clave, no de una persona.
      user: {
        id: `api:${apiToken.id}`,
        name: `API · ${apiToken.name}`,
        email: apiToken.createdByEmail ?? "",
        role: apiToken.role,
      },
      // Contexto sintético: la clave no tiene sesión de navegador ni PIN.
      session: {
        id: `api:${apiToken.id}`,
        userId: "",
        activeOrganizationId: apiToken.organization.id,
        expiresAt: new Date(Date.now() + 100 * 365 * 86_400_000),
        revokedAt: null,
        lockedAt: null,
        lockAttempts: 0,
        lockReason: null,
        createdAt: new Date(0),
      },
      organization: apiToken.organization,
      role: apiToken.role,
      organizationId: apiToken.organization.id,
      demo,
      sandbox,
    },
  };
}

export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  role: AdminRole;
};

/** Empresas activas a las que pertenece el usuario (para el selector del panel). */
export async function listAdminOrganizations(adminUserId: string): Promise<AdminOrganization[]> {
  const memberships = await db.adminMembership.findMany({
    where: { adminUserId, active: true, organization: { active: true } },
    orderBy: { createdAt: "asc" },
    include: { organization: { select: organizationSelect } },
  });
  return memberships.map((membership) => ({ ...membership.organization, role: membership.role }));
}

/** Cambia la empresa activa de la sesión validando que exista membresía activa. */
export async function setActiveOrganization(
  context: AdminContext,
  organizationId: string,
): Promise<AdminOrganization | null> {
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: context.user.id, organizationId, active: true, organization: { active: true } },
    include: { organization: { select: organizationSelect } },
  });
  if (!membership) return null;
  await db.adminSession.update({
    where: { id: context.session.id },
    data: { activeOrganizationId: membership.organizationId },
  });
  return { ...membership.organization, role: membership.role };
}

/**
 * Filtro único de las empresas que un usuario puede elegir como predeterminada: membresía activa, empresa
 * activa y que no sea la demo (vitrina). Cuando entre la demo interactiva (sandboxes con `isDemo`), se suma ACÁ.
 */
export function selectableMembershipWhere(adminUserId: string) {
  // Nunca la demo: ni la vitrina (slug) ni las sandboxes de los visitantes (isDemo).
  return { adminUserId, active: true, organization: { active: true, isDemo: false, slug: { not: DEMO_ORGANIZATION_SLUG } } } as const;
}

/** Empresas que el usuario puede fijar como predeterminada (nunca ajenas, demo ni inactivas). */
export async function listSelectableOrganizations(adminUserId: string): Promise<AdminOrganization[]> {
  const memberships = await db.adminMembership.findMany({
    where: selectableMembershipWhere(adminUserId),
    orderBy: { createdAt: "asc" },
    include: { organization: { select: organizationSelect } },
  });
  return memberships.map((membership) => ({ ...membership.organization, role: membership.role }));
}

/** Fija (o limpia con `null`) la empresa predeterminada. `false` = no es una empresa elegible del usuario (403). */
export async function setDefaultOrganization(adminUserId: string, organizationId: string | null): Promise<boolean> {
  if (organizationId !== null) {
    const allowed = await db.adminMembership.findFirst({
      where: { ...selectableMembershipWhere(adminUserId), organizationId },
      select: { id: true },
    });
    if (!allowed) return false;
  }
  await db.adminUser.update({ where: { id: adminUserId }, data: { defaultOrganizationId: organizationId } });
  return true;
}

/** Predeterminada vigente del usuario, o `null` si no eligió una o ya no vale. */
async function validDefaultOrganizationId(adminUserId: string): Promise<string | null> {
  const user = await db.adminUser.findUnique({ where: { id: adminUserId }, select: { defaultOrganizationId: true } });
  if (!user?.defaultOrganizationId) return null;
  const membership = await db.adminMembership.findFirst({
    where: { ...selectableMembershipWhere(adminUserId), organizationId: user.defaultOrganizationId },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/**
 * Empresa que se abre al iniciar sesión: la predeterminada si sigue valiendo; si no (membresía revocada,
 * empresa desactivada), la primera membresía activa.
 */
export async function resolveActiveOrganizationId(adminUserId: string): Promise<string | null> {
  const preferred = await validDefaultOrganizationId(adminUserId);
  if (preferred) return preferred;
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId, active: true, organization: { active: true } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/** Organización por defecto para los endpoints públicos (leads y cotizaciones). */
export async function resolveDefaultOrganizationId(): Promise<string | null> {
  const slug = (process.env.DEFAULT_ORGANIZATION_SLUG || "ledbox").trim();
  // La vitrina y las sandboxes de la demo (`isDemo`) nunca reciben leads ni cotizaciones públicas.
  const slugId = slug ? await resolveOrganizationSlugId(slug) : null;
  const bySlug = slugId
    ? await db.organization.findFirst({ where: { id: slugId, active: true, isDemo: false }, select: { id: true } })
    : null;
  if (bySlug) return bySlug.id;
  // Un default conocido pero inactivo, eliminado o ambiguo no desvía leads a otro tenant.
  if (slugId || (slug && await organizationSlugHasHistory(slug))) return null;
  const fallback = await db.organization.findFirst({
    where: { active: true, isDemo: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return fallback?.id ?? null;
}
