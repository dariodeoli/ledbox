import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/demo-sandbox.pg.test.ts
// Las sandboxes se crean a mano (isDemo + demoParentId): el seed con `ns` es de otra etapa.
test("demo interactiva E1: migración, sin-demo, salidas, plan, cuota de archivos y vistas públicas en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();

  // Mock del proveedor de correo: cuenta cada llamada que llega al «proveedor».
  let providerHits = 0;
  const mock = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      providerHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `mock-${providerHits}` }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const port = (mock.address() as { port: number }).port;
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}`;

  const { db } = await import("../lib/server/db");
  const { Prisma } = await import("@prisma/client");
  const sandboxLib = await import("../lib/server/demo-sandbox");
  const { sendMail } = await import("../lib/server/mail/send");
  const { planLimitViolation } = await import("../lib/server/plan-limits");
  const { orgReal, orgDemo, usuarioReal } = await import("../lib/platform/sin-demo");
  const { resolveDefaultOrganizationId } = await import("../lib/server/tenancy");
  const { resolvePublicCatalog } = await import("../lib/server/catalog-public");
  const { parseImageUpload } = await import("../lib/server/branding");
  const { resolvePeriod } = await import("../lib/platform/periods");
  const { parseTableParams } = await import("../lib/platform/tablas");
  const emp = await import("../lib/platform/queries/empresas");
  const usr = await import("../lib/platform/queries/usuarios");

  const tag = `Zsb${randomUUID().slice(0, 6)}`;
  const slugTag = tag.toLowerCase();
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const planIds: string[] = [];
  t.after(async () => {
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await db.mailLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
    await db.plan.deleteMany({ where: { id: { in: planIds } } });
    sandboxLib.clearSandboxCache();
  });

  const newOrg = async (key: string, data: Record<string, unknown> = {}) => {
    const id = `org-${slugTag}-${key}`;
    orgIds.push(id);
    await db.organization.create({ data: { id, name: `${tag} ${key}`, slug: `${slugTag}-${key}`, ...data } as never });
    return id;
  };
  const newUser = async (key: string, extra: Record<string, unknown> = {}) => {
    const id = `usr-${slugTag}-${key}`;
    userIds.push(id);
    await db.adminUser.create({ data: { id, name: `${tag} ${key}`, email: `${slugTag}-${key}@test.dev`, passwordHash: "x", role: "OWNER", ...extra } as never });
    return id;
  };

  // Una empresa real, una sandbox (isDemo + demoParentId) y una «vitrina» con otro slug (isDemo sin padre).
  const realOrg = await newOrg("real");
  const sandboxOrg = await newOrg("sbx", { isDemo: true, demoParentId: "org_demo", demoExpiresAt: new Date(Date.now() + 86_400_000), demoLastSeenAt: new Date() });
  const vitrinaOrg = await newOrg("vit", { isDemo: true });
  const visitor = await newUser("visitor", { demoOrganizationId: sandboxOrg });
  const owner = await newUser("owner");
  const mixed = await newUser("mixed");
  await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: visitor, organizationId: sandboxOrg, role: "OWNER" } });
  await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: owner, organizationId: realOrg, role: "OWNER" } });
  await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: mixed, organizationId: sandboxOrg, role: "OWNER" } });
  await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: mixed, organizationId: realOrg, role: "ADMIN" } });

  await t.test("criterio 1: la migración corre dos veces y la vitrina queda isDemo = true", async () => {
    // La vitrina del entorno (slug demo): si no existe todavía, se crea mínima para la prueba.
    const demoId = (await db.organization.findUnique({ where: { slug: "demo" }, select: { id: true } }))?.id;
    if (!demoId) await db.organization.create({ data: { id: "org_demo", name: "LedBox Demo", slug: "demo" } });
    await db.organization.update({ where: { slug: "demo" }, data: { isDemo: false } });
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/202610190001_demo_sandbox/migration.sql"), "utf8");
    const statements = sql.split(/;\s*\n/).map((part) => part.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    assert.ok(statements.length >= 10, "la migración tiene sus sentencias");
    for (let run = 0; run < 2; run += 1) for (const statement of statements) await db.$executeRawUnsafe(statement);
    assert.equal((await db.organization.findUnique({ where: { slug: "demo" }, select: { isDemo: true } }))?.isDemo, true);
    assert.equal((await db.organization.findUnique({ where: { id: realOrg }, select: { isDemo: true } }))?.isDemo, false, "las reales no se tocan");
  });

  await t.test("criterio 2: una empresa isDemo con otro slug no cuenta en empresas, KPIs ni usuarios reales", async () => {
    const real = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT o."id" FROM "Organization" o WHERE o."slug" LIKE ${`${slugTag}-%`} AND ${orgReal("o", "id")} ORDER BY o."id"`);
    assert.deepEqual(real.map((r) => r.id), [realOrg]);
    const demos = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT o."id" FROM "Organization" o WHERE o."slug" LIKE ${`${slugTag}-%`} AND ${orgDemo("o", "id")} ORDER BY o."id"`);
    assert.deepEqual(demos.map((r) => r.id).sort(), [sandboxOrg, vitrinaOrg].sort());
    const users = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT u."id" FROM "AdminUser" u WHERE u."email" LIKE ${`${slugTag}-%`} AND ${usuarioReal("u", "id")} ORDER BY u."id"`);
    assert.deepEqual(users.map((r) => r.id).sort(), [mixed, owner].sort(), "el visitante de la sandbox no es un usuario real; quien además está en una real, sí");

    const range = resolvePeriod("30d", new Date());
    const empParams = parseTableParams({ q: tag }, { sorts: emp.EMPRESA_SORTS, filterOptions: { activa: ["si", "no"], plan: [] } });
    const empresas = await emp.loadEmpresas(range, empParams);
    assert.deepEqual(empresas.rows.map((r) => r.id), [realOrg], "la tabla de empresas muestra solo la real");
    assert.ok(empresas.demoOrgs >= 2, "las demos se cuentan aparte");
    assert.equal(await emp.loadEmpresaDetail(sandboxOrg), null, "no hay detalle de una sandbox");
    const usrParams = parseTableParams({ q: tag }, { sorts: usr.USUARIO_SORTS, filterOptions: { activa: ["si", "no"], verificado: ["si", "no"], pin: ["si", "no"] } });
    const usuarios = await usr.loadUsuarios(usrParams);
    assert.deepEqual(usuarios.rows.map((r) => r.id).sort(), [mixed, owner].sort());
    assert.equal(await usr.loadUsuarioDetail(visitor), null);
  });

  await t.test("isSandboxOrg distingue sandbox, vitrina y empresa real (y cachea 60 s)", async () => {
    sandboxLib.clearSandboxCache();
    assert.equal(await sandboxLib.isSandboxOrg(sandboxOrg), true);
    assert.equal(await sandboxLib.isSandboxOrg(vitrinaOrg), false, "isDemo sin demoParentId es la vitrina");
    assert.equal(await sandboxLib.isSandboxOrg(realOrg), false);
    assert.equal(await sandboxLib.isSandboxOrg(null), false);
    assert.equal(await sandboxLib.isSandboxOrg("no-existe"), false);
    const t0 = Date.now();
    await db.organization.update({ where: { id: sandboxOrg }, data: { demoParentId: null } });
    assert.equal(await sandboxLib.isSandboxOrg(sandboxOrg, t0), true, "dentro de los 60 s responde desde la caché");
    assert.equal(await sandboxLib.isSandboxOrg(sandboxOrg, t0 + 61_000), false, "vencida la caché vuelve a leer");
    await db.organization.update({ where: { id: sandboxOrg }, data: { demoParentId: "org_demo" } });
    sandboxLib.clearSandboxCache();
    assert.equal(await sandboxLib.isSandboxOrg(sandboxOrg), true);
  });

  await t.test("criterio 6: en una sandbox, presupuesto, recordatorio, prueba y OTP no llegan al proveedor y dejan MailLog skipped", async () => {
    providerHits = 0;
    const categories = ["budget", "reminder", "test", "signature"] as const;
    for (const category of categories) {
      const result = await sendMail({ to: "cliente@gmail.com", subject: `S ${category}`, category, html: "<p>x</p>", organizationId: sandboxOrg, entity: "Budget", entityId: "b1" });
      assert.equal(result.status, "skipped", category);
      assert.equal(result.error, "Demo: simulado");
      assert.ok(result.logId, "queda registrado");
    }
    assert.equal(providerHits, 0, "0 llamadas al mock RESEND_BASE_URL");
    const logs = await db.mailLog.findMany({ where: { organizationId: sandboxOrg }, orderBy: { createdAt: "asc" } });
    assert.equal(logs.length, 4);
    assert.ok(logs.every((log) => log.status === "skipped" && log.error === "Demo: simulado" && !log.providerId));
    assert.deepEqual(logs.map((log) => log.category).sort(), [...categories].sort());
  });

  await t.test("criterio 7: en una empresa real se envía igual; un destino *.demo nunca sale", async () => {
    providerHits = 0;
    const sent = await sendMail({ to: "cliente@gmail.com", subject: "Real", category: "budget", html: "<p>x</p>", organizationId: realOrg });
    assert.equal(sent.status, "sent");
    assert.equal(providerHits, 1, "la empresa real llega al proveedor");
    for (const org of [realOrg, sandboxOrg, null]) {
      const blocked = await sendMail({ to: "visitante+abc123@ledbox.demo", subject: "Demo", category: "invitation", html: "<p>x</p>", organizationId: org });
      assert.equal(blocked.status, "skipped");
      assert.equal(blocked.error, "Demo: simulado");
    }
    assert.equal(providerHits, 1, "ningún *.demo salió");
    assert.equal((await sandboxLib.salidaPermitida({ organizationId: realOrg, canal: "mail", destino: "a@b.com" })).hasOwnProperty("ok"), true);
    assert.equal("simulado" in (await sandboxLib.salidaPermitida({ organizationId: realOrg, canal: "webhook", destino: "https://x.demo/hook" })), true);
    assert.equal("simulado" in (await sandboxLib.salidaPermitida({ organizationId: vitrinaOrg, canal: "mail", destino: "a@b.com" })), false, "la vitrina no es sandbox");
    assert.equal(sandboxLib.destinoDemo("A@LedBox.DEMO"), true);
    assert.equal(sandboxLib.destinoDemo("a@demo.com"), false);
    assert.equal(sandboxLib.destinoDemo("a@ledbox.demo.com"), false);
  });

  await t.test("criterio 9 (parte de datos): la sandbox se detecta; el 403 de las rutas lo da requireAdminContext (ver demo-salidas.test.ts)", async () => {
    assert.equal(await sandboxLib.isSandboxOrg(sandboxOrg), true);
    assert.equal(sandboxLib.SANDBOX_DENIED_MESSAGE, "En la demo esto está desactivado");
  });

  await t.test("planLimitViolation devuelve null en una sandbox y el tope en una empresa real", async () => {
    const planId = `plan-${slugTag}`;
    planIds.push(planId);
    await db.plan.create({ data: { id: planId, code: planId, name: `${tag} Tope`, maxUsers: 0, maxEventsPerMonth: 0, priceMonthly: 0, active: false } });
    await db.organization.updateMany({ where: { id: { in: [realOrg, sandboxOrg] } }, data: { planId } });
    const ctx = (id: string) => ({ organizationId: id, organization: { id, name: "x", slug: "x", planId } });
    for (const resource of ["events", "users"] as const) {
      const real = await planLimitViolation(ctx(realOrg), resource);
      assert.equal(real?.code, "plan_limit", `${resource}: la real llega al tope`);
      assert.equal(await planLimitViolation(ctx(sandboxOrg), resource), null, `${resource}: la sandbox no tiene tope`);
    }
  });

  await t.test("criterio 10: tope de 15 MB por sandbox; la real no tiene tope de demo; identidad de 1,1 MB sigue con su error", async () => {
    const budgetClient = await db.client.create({ data: { id: randomUUID(), organizationId: sandboxOrg, name: "C" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: sandboxOrg, clientId: budgetClient.id, title: "P", status: "DRAFT", subtotal: 0, total: 0 } as never });
    const MB = 1024 * 1024;
    assert.equal(await sandboxLib.bytesDeArchivos(sandboxOrg), 0);
    assert.equal(await sandboxLib.cuotaArchivosOk(sandboxOrg, 15 * MB), true, "justo en el tope");
    assert.equal(await sandboxLib.cuotaArchivosOk(sandboxOrg, 15 * MB + 1), false);
    const attach = (size: number, name: string) => db.budgetAttachment.create({ data: { id: randomUUID(), organizationId: sandboxOrg, budgetId: budget.id, uploadedByName: "v", name, mime: "image/png", size, data: new Uint8Array(size) } });
    await attach(5 * MB, "a"); await attach(5 * MB, "b"); await attach(4 * MB, "c");
    assert.equal(await sandboxLib.bytesDeArchivos(sandboxOrg), 14 * MB);
    assert.equal(await sandboxLib.cuotaArchivosOk(sandboxOrg, MB), true, "14 + 1 = 15 MB entra");
    assert.equal(await sandboxLib.cuotaArchivosOk(sandboxOrg, MB + 1), false, "pasar 15 MB → la ruta responde 413");
    // El avatar del visitante cuenta contra su sandbox.
    await db.adminUserAvatar.create({ data: { id: randomUUID(), userId: visitor, mime: "image/png", size: 512 * 1024, data: new Uint8Array(512 * 1024) } });
    assert.equal(await sandboxLib.bytesDeArchivos(sandboxOrg), 14 * MB + 512 * 1024);
    assert.equal(await sandboxLib.cuotaArchivosOk(sandboxOrg, MB), false);
    // Fuera de una sandbox no hay tope de demo (rigen los topes por archivo de cada ruta).
    assert.equal(await sandboxLib.cuotaArchivosOk(realOrg, 100 * MB), true);
    assert.equal(await sandboxLib.cuotaArchivosOk(vitrinaOrg, 100 * MB), true);
    // La imagen de identidad de 1,1 MB sigue rechazándose con el error actual.
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(Math.round(1.1 * MB))]).toString("base64");
    const parsed = parseImageUpload({ data: big });
    assert.equal(parsed.ok, false);
    assert.equal(!parsed.ok && parsed.error, "La imagen supera 1 MB: recortala o comprimila antes de subirla.");
  });

  await t.test("vistas públicas: resolveDefaultOrganizationId y el catálogo excluyen la demo", async () => {
    const previous = process.env.DEFAULT_ORGANIZATION_SLUG;
    try {
      process.env.DEFAULT_ORGANIZATION_SLUG = `${slugTag}-sbx`;
      const byDemoSlug = await resolveDefaultOrganizationId();
      assert.notEqual(byDemoSlug, sandboxOrg, "ni por slug explícito se resuelve una empresa isDemo");
      if (byDemoSlug) assert.equal((await db.organization.findUnique({ where: { id: byDemoSlug }, select: { isDemo: true } }))?.isDemo, false);
      process.env.DEFAULT_ORGANIZATION_SLUG = `${slugTag}-real`;
      assert.equal(await resolveDefaultOrganizationId(), realOrg, "la real sí");
      process.env.DEFAULT_ORGANIZATION_SLUG = `no-existe-${slugTag}`;
      const fallback = await resolveDefaultOrganizationId();
      if (fallback) assert.equal((await db.organization.findUnique({ where: { id: fallback }, select: { isDemo: true } }))?.isDemo, false, "el respaldo por antigüedad tampoco elige una demo");
    } finally {
      if (previous === undefined) delete process.env.DEFAULT_ORGANIZATION_SLUG;
      else process.env.DEFAULT_ORGANIZATION_SLUG = previous;
    }
    for (const id of [realOrg, sandboxOrg, vitrinaOrg]) await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: id, publicCatalogEnabled: true } as never });
    assert.ok(await resolvePublicCatalog(`${slugTag}-real`), "la real publica su tienda");
    assert.equal(await resolvePublicCatalog(`${slugTag}-sbx`), null, "la tienda de una sandbox no existe por slug");
    assert.ok(await resolvePublicCatalog(`${slugTag}-vit`), "la vitrina (isDemo sin padre) conserva su tienda de solo lectura");
  });
});
