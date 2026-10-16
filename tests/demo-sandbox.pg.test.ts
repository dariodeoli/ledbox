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

// ── E2: seed con ns, aislamiento, reinicio, topes, concurrencia y purga ─────────────────────────────────
// Criterios 3, 4, 5, 11, 14, 15, 16, 17 y 18 (docs/DEMO-INTERACTIVA.md §8). Postgres descartable, en serie.
async function e2Setup() {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const demoData = await import("../lib/server/demo-data");
  const sandboxes = await import("../lib/server/demo-sandboxes");
  const sandboxLib = await import("../lib/server/demo-sandbox");
  const host = await import("../lib/server/demo-host");
  const resetBuckets = () => db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "demo:sbx:" } } });
  const purgeAll = async () => {
    await sandboxes.purgeExpiredSandboxes({ limit: 1000, now: new Date(Date.now() + 3 * 86_400_000) });
    sandboxLib.clearSandboxCache();
  };
  return { db, dbWithDeleted, demoData, sandboxes, sandboxLib, host, resetBuckets, purgeAll };
}

/** Datos operativos deben desaparecer; el namespace conserva sólo su tombstone de URL. */
async function leftovers(db: Awaited<ReturnType<typeof e2Setup>>["db"], organizationId: string, ns: string) {
  const tables = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_name = 'organizationId' OR (column_name = 'id' AND data_type = 'text'))`;
  const found: string[] = [];
  for (const { table_name, column_name } of tables) {
    // Única excepción: no son datos de la sandbox sino reserva perpetua de su URL (#261).
    if (table_name === "OrganizationSlug" && column_name === "organizationId") continue;
    const sql =
      column_name === "organizationId"
        ? `SELECT count(*)::int AS n FROM "${table_name}" WHERE "organizationId" = $1`
        : `SELECT count(*)::int AS n FROM "${table_name}" WHERE starts_with("id", $1)`;
    const rows = await db.$queryRawUnsafe<Array<{ n: number }>>(sql, column_name === "organizationId" ? organizationId : `sbx_${ns}_`);
    if ((rows[0]?.n ?? 0) > 0) found.push(`${table_name}.${column_name}=${rows[0].n}`);
  }
  const tombstones = await db.$queryRaw<Array<{ slug: string; organizationId: string }>>`
    SELECT "slug", "organizationId" FROM "OrganizationSlug" WHERE "organizationId" = ${organizationId}`;
  assert.deepEqual(tombstones, [{ slug: `demo-${ns}`, organizationId }], "la URL anterior conserva sólo su propietario histórico");
  assert.equal(await db.organization.findUnique({ where: { id: organizationId } }), null, "la empresa purgada no existe");
  const { assertOrganizationSlugAvailable, OrganizationSlugTaken, resolveOrganizationSlugId } = await import("../lib/server/organization-slugs");
  assert.equal(await resolveOrganizationSlugId(`demo-${ns}`), null, "el tombstone no resuelve a una empresa eliminada");
  await assert.rejects(() => db.$transaction(tx => assertOrganizationSlugAvailable(tx, `demo-${ns}`, `not-owner-${ns}`)), OrganizationSlugTaken,
    "otra empresa no puede apropiarse de la URL purgada");
  const users = await db.adminUser.count({ where: { demoOrganizationId: organizationId } });
  if (users) found.push(`AdminUser=${users}`);
  return found;
}

test("demo interactiva E2: seed con ns, aislamiento entre sandboxes, reinicio y purga en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { db, dbWithDeleted, demoData, sandboxes, sandboxLib, host, resetBuckets, purgeAll } = await e2Setup();
  const { verifySignatureChain } = await import("../lib/server/signature/hash");
  t.after(async () => {
    await purgeAll();
    await resetBuckets();
  });
  await purgeAll();
  await resetBuckets();
  await demoData.ensureDemoData({ reset: true } as never);
  const showcaseId = demoData.DEMO_ORGANIZATION_ID;

  await t.test("5 y E0: sin ns la vitrina queda isDemo = true con los mismos ids y tokens de siempre", async () => {
    assert.equal((await db.organization.findUnique({ where: { id: showcaseId }, select: { isDemo: true } }))?.isDemo, true, "ensureDemoData marca isDemo");
    await db.organization.update({ where: { id: showcaseId }, data: { isDemo: false } });
    await demoData.ensureDemoData();
    assert.equal((await db.organization.findUnique({ where: { id: showcaseId }, select: { isDemo: true } }))?.isDemo, true, "y lo repone si faltaba");
    for (const id of ["demo_client_tigo", "demo_client_pixel"]) assert.ok(await db.client.findUnique({ where: { id } }), id);
    for (const id of ["demo_budget_aprobado", "demo_budget_pendiente", "demo_budget_firmado"]) assert.ok(await dbWithDeleted.budget.findUnique({ where: { id } }), id);
    assert.ok(await db.signatureRequest.findUnique({ where: { id: "demo_sig_firmado" } }));
    assert.ok(await db.adminUser.findUnique({ where: { id: "demo_user_valeria" } }));
    assert.equal((await db.adminUser.findUnique({ where: { id: "demo_user_valeria" } }))?.email, "valeria.ortiz@ledbox.demo", "sin +ns");
    assert.equal((await db.budget.findUnique({ where: { id: "demo_budget_pendiente" }, select: { publicToken: true } }))?.publicToken, "D3M9-F3R4-A2PY-Q7SC-K4VT", "tokens literales");
    const clients = await db.client.findMany({ where: { organizationId: showcaseId }, select: { id: true } });
    assert.ok(clients.every((c) => c.id.startsWith("demo_")), "ningún id sbx_ en la vitrina");
  });

  const timings: number[] = [];
  const created: Array<{ organizationId: string; ns: string; userId: string }> = [];
  const make = async (ip: string) => {
    const started = performance.now();
    const result = await sandboxes.createSandbox({ ip });
    timings.push(performance.now() - started);
    assert.ok(result.ok, `createSandbox falló: ${JSON.stringify(result)}`);
    if (!result.ok) throw new Error("unreachable");
    created.push({ organizationId: result.sandbox.organizationId, ns: result.sandbox.ns, userId: result.sandbox.user.id });
    return result.sandbox;
  };

  const tablesToCompare = ["client", "clientLogo", "event", "eventTask", "supplier", "supplierJob", "budget", "budgetItem", "lead", "quoteRequest", "quoteItem", "signatureRequest", "signatureEvent", "signatureEvidence", "inventoryItem", "inventoryUnit", "inventoryComponent", "eventInventory", "inventoryIncident", "promoter", "treasuryAccount", "clientPayment", "treasuryMovement", "expense", "expectedPayment", "teamInvitation", "mailLog", "messageTemplate", "paymentReminderLog", "invoice", "purchaseInvoice", "fiscalPeriod", "budgetPaymentProof", "budgetChangeRequest", "auditLog", "catalogAccessToken", "organizationLogo", "bankStatement", "bankStatementRow", "organizationRentalSettings"] as const;
  const counts = async (organizationId: string) => {
    const out: Record<string, number> = {};
    for (const table of tablesToCompare) {
      const model = (dbWithDeleted as unknown as Record<string, { count: (args: unknown) => Promise<number> }>)[table];
      const where = ["clientLogo", "eventTask", "budgetItem", "quoteItem", "eventInventory", "invoiceItem"].includes(table)
        ? table === "clientLogo" ? { client: { organizationId } } : table === "eventTask" || table === "eventInventory" ? { event: { organizationId } } : table === "budgetItem" ? { budget: { organizationId } } : { quoteRequest: { organizationId } }
        : { organizationId };
      out[table] = await model.count({ where });
    }
    return out;
  };

  const A = await make("10.9.0.1");
  const B = await make("10.9.0.2");

  await t.test("3: dos ns en la misma base completan el dataset de la vitrina, sin choques ni ids demo_", async () => {
    const vitrina = await counts(showcaseId);
    assert.deepEqual(await counts(A.organizationId), vitrina, "la sandbox A tiene las mismas filas que la vitrina");
    assert.deepEqual(await counts(B.organizationId), vitrina, "y la B");
    for (const sandbox of [A, B]) {
      const org = await db.organization.findUniqueOrThrow({ where: { id: sandbox.organizationId } });
      assert.equal(org.isDemo, true);
      assert.equal(org.demoParentId, showcaseId);
      assert.equal(org.demoReady, true);
      assert.equal(org.slug, `demo-${sandbox.ns}`);
      assert.ok(org.demoExpiresAt && org.demoExpiresAt.getTime() > Date.now() + 23 * 3_600_000);
      const clients = await db.client.findMany({ where: { organizationId: sandbox.organizationId }, select: { id: true } });
      assert.ok(clients.length > 0 && clients.every((c) => c.id.startsWith(`sbx_${sandbox.ns}_`)), "ids sbx_<ns>_*");
      const membership = await db.adminMembership.findMany({ where: { organizationId: sandbox.organizationId }, select: { adminUserId: true, role: true } });
      assert.equal(membership.find((m) => m.adminUserId === sandbox.user.id)?.role, "OWNER", "el visitante es OWNER");
      const collaborators = await db.adminUser.findMany({ where: { demoOrganizationId: sandbox.organizationId } });
      assert.ok(collaborators.length >= 3 && collaborators.every((u) => u.email.includes(`+${sandbox.ns}@`)), "colaboradores con +ns");
      const avatars = await db.adminUserAvatar.count({ where: { user: { demoOrganizationId: sandbox.organizationId } } });
      assert.equal(avatars, collaborators.length, "cada usuario tiene su avatar (incluido el visitante)");
      // Las huellas de la firma se calcularon con los ids de la sandbox: la cadena verifica.
      const requests = await db.signatureRequest.findMany({ where: { organizationId: sandbox.organizationId }, include: { events: { orderBy: { occurredAt: "asc" } } } });
      assert.ok(requests.length >= 8);
      for (const request of requests) assert.deepEqual(verifySignatureChain(request.events), { valid: true, brokenAt: null }, `cadena rota en ${request.id}`);
    }
    // Tokens y códigos públicos al azar por sandbox: nada se repite entre sandboxes ni con la vitrina.
    const publicTokens = async (organizationId: string) => (await db.budget.findMany({ where: { organizationId, publicToken: { not: null } }, select: { publicToken: true } })).map((b) => b.publicToken!);
    const [tv, ta, tb] = [await publicTokens(showcaseId), await publicTokens(A.organizationId), await publicTokens(B.organizationId)];
    assert.ok(ta.length === tv.length && tb.length === tv.length);
    assert.equal(new Set([...tv, ...ta, ...tb]).size, tv.length * 3, "tokens de presupuesto distintos");
    const codes = async (organizationId: string) => (await db.signatureRequest.findMany({ where: { organizationId }, select: { publicCode: true } })).map((s) => s.publicCode);
    const [cv, ca, cb] = [await codes(showcaseId), await codes(A.organizationId), await codes(B.organizationId)];
    assert.equal(new Set([...cv, ...ca, ...cb]).size, cv.length * 3, "códigos de firma distintos");
    const quoteTokens = async (organizationId: string) => (await db.quoteRequest.findMany({ where: { organizationId }, select: { publicToken: true } })).map((q) => q.publicToken);
    assert.equal(new Set([...(await quoteTokens(showcaseId)), ...(await quoteTokens(A.organizationId)), ...(await quoteTokens(B.organizationId))]).size, (await quoteTokens(showcaseId)).length * 3, "tokens de pedidos distintos");
    const hashes = await db.catalogAccessToken.findMany({ where: { organizationId: { in: [showcaseId, A.organizationId, B.organizationId] } }, select: { tokenHash: true } });
    assert.equal(new Set(hashes.map((h) => h.tokenHash)).size, hashes.length, "links mayoristas distintos");
    // La vitrina no cambió con las altas de sandboxes.
    assert.deepEqual(await counts(showcaseId), vitrina);
  });

  await t.test("4: el alta de una sandbox (p95 de 10 corridas) tarda menos de 2,5 s", async () => {
    for (let i = 0; i < 8; i += 1) {
      const extra = await make(`10.9.1.${i}`);
      await sandboxes.purgeSandbox(extra.organizationId);
      created.pop();
    }
    assert.equal(timings.length, 10);
    const sorted = [...timings].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    console.log(`demo-sandbox E2: alta de sandbox, 10 corridas (ms): ${timings.map((x) => Math.round(x)).join(" ")}; p95 = ${Math.round(p95)} ms`);
    assert.ok(p95 < 2500, `p95 ${Math.round(p95)} ms`);
  });

  await t.test("11: lo que se hace en A no aparece en B ni en la vitrina", async () => {
    const before = { b: await counts(B.organizationId), v: await counts(showcaseId) };
    const client = await db.client.create({ data: { id: `${A.ns}-nuevo`, organizationId: A.organizationId, name: "Cliente solo de A", type: "FINAL", active: true } as never });
    const event = await db.event.create({ data: { id: `${A.ns}-evento`, organizationId: A.organizationId, clientId: client.id, name: "Reserva solo de A", startsAt: new Date(Date.now() + 5 * 86_400_000), endsAt: new Date(Date.now() + 6 * 86_400_000), status: "CONFIRMED" } as never });
    await db.auditLog.create({ data: { id: `${A.ns}-aud-1`, organizationId: A.organizationId, actorId: A.user.id, actorName: "Visitante demo", actorEmail: A.user.email, action: "create", entity: "Event", entityId: event.id, summary: "Creó una reserva" } });
    await db.mailLog.create({ data: { id: `${A.ns}-mail`, organizationId: A.organizationId, category: "budget", status: "skipped", to: "x@cliente.demo", subject: "Demo: simulado", error: "Demo: simulado" } as never });
    assert.deepEqual(await counts(B.organizationId), before.b, "B intacta");
    assert.deepEqual(await counts(showcaseId), before.v, "la vitrina intacta");
    for (const where of [{ name: "Reserva solo de A" }, { name: { contains: "solo de A" } }]) {
      assert.equal(await db.event.count({ where: { ...where, organizationId: B.organizationId } }), 0, "no aparece en la búsqueda de B");
      assert.equal(await db.event.count({ where: { ...where, organizationId: showcaseId } }), 0);
    }
    assert.equal(await db.client.count({ where: { name: "Cliente solo de A", organizationId: { not: A.organizationId } } }), 0);
  });

  await t.test("18: el portal y la firma de una sandbox solo se ven en el host demo", async () => {
    assert.equal(await host.sandboxHiddenHere(A.organizationId, "clientes.ledbox.online"), true, "404 en clientes.");
    assert.equal(await host.sandboxHiddenHere(A.organizationId, "app.ledbox.online"), true, "404 en app.");
    assert.equal(await host.sandboxHiddenHere(A.organizationId, "demo.ledbox.online"), false, "visible en demo.");
    assert.equal(await host.sandboxHiddenHere(showcaseId, "clientes.ledbox.online"), false, "la vitrina conserva su portal");
    assert.equal(await host.sandboxHiddenHere(A.organizationId), false, "fuera de un request no hay host y no oculta nada");
    assert.equal(host.isDemoHostName("demo.ledbox.online:443"), true);
    assert.equal(host.isDemoHostName("clientes.ledbox.online"), false);
  });

  await t.test("QA E1: una sandbox recién creada pasa por sandbox de inmediato (sin caché vieja)", async () => {
    const ghost = `sbx_zzzzzzzzzz_org`;
    assert.equal(await sandboxLib.isSandboxOrg(ghost), false, "todavía no existe");
    await db.organization.create({ data: { id: ghost, name: "Fantasma", slug: "demo-zzzzzzzzzz", isDemo: true, demoParentId: showcaseId, demoReady: false } });
    assert.equal(await sandboxLib.isSandboxOrg(ghost), true, "no se cacheó la ausencia");
    await db.organization.delete({ where: { id: ghost } });
    sandboxLib.clearSandboxCache();
  });

  await t.test("17: la purga corre dos veces; guarda DemoSession.actions antes de borrar", async () => {
    await db.demoSession.create({ data: { id: `${A.ns}-ds`, visitorHash: `vh-${A.ns}`, sandboxOrgId: A.organizationId } });
    const mail = await db.auditLog.count({ where: { organizationId: A.organizationId, id: { startsWith: `${A.ns}-` } } });
    assert.equal(mail, 1);
    const future = new Date(Date.now() + 2 * 3_600_000);
    // Solo A venció (la dejamos sin uso); B se mantiene viva.
    await db.organization.update({ where: { id: A.organizationId }, data: { demoLastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    const first = await sandboxes.purgeExpiredSandboxes({ limit: 5, now: new Date() });
    const second = await sandboxes.purgeExpiredSandboxes({ limit: 5, now: new Date() });
    assert.equal(first, 1, "borró solo la vencida");
    assert.equal(second, 0, "la segunda corrida no encuentra nada");
    assert.equal(await sandboxes.purgeSandbox(A.organizationId), false, "purgar de nuevo no hace nada");
    const session = await db.demoSession.findUniqueOrThrow({ where: { id: `${A.ns}-ds` } });
    assert.equal(session.actions, 1, "la acción del visitante quedó anotada");
    assert.deepEqual(session.actionsByEntity, { Event: 1 });
    assert.ok(future.getTime() > Date.now());
    assert.ok(await db.organization.findUnique({ where: { id: B.organizationId } }), "B sigue");
    await db.demoSession.delete({ where: { id: `${A.ns}-ds` } });
  });

  await t.test("14: tras purgar A no queda ninguna fila sbx_<ns>_*, usuario ni archivo; B y la vitrina siguen", async () => {
    assert.deepEqual(await leftovers(db, A.organizationId, A.ns), []);
    assert.equal(await db.client.count({ where: { id: `${A.ns}-nuevo` } }), 0, "tampoco lo que creó el visitante");
    assert.equal(await sandboxLib.bytesDeArchivos(A.organizationId), 0);
    assert.ok((await db.client.count({ where: { organizationId: B.organizationId } })) > 0);
    assert.ok((await db.client.count({ where: { organizationId: showcaseId } })) > 0);
  });

  await t.test("reiniciar: la nueva queda lista y la anterior se purga entera (organización, usuarios y archivos)", async () => {
    const before = await make("10.9.2.1");
    await db.clientLogo.count({ where: { client: { organizationId: before.organizationId } } });
    const next = await make("10.9.2.1");
    assert.notEqual(next.organizationId, before.organizationId);
    assert.equal(await sandboxes.purgeSandbox(before.organizationId), true);
    assert.deepEqual(await leftovers(db, before.organizationId, before.ns), [], "en 0 todo lo de la anterior");
    assert.equal((await db.organization.findUnique({ where: { id: next.organizationId }, select: { demoReady: true } }))?.demoReady, true);
    await sandboxes.purgeSandbox(next.organizationId);
    created.splice(created.findIndex((c) => c.organizationId === next.organizationId), 1);
  });

  // QA: purgar una sandbox no puede tocar a los colaboradores de la vitrina (ids literales demo_user_*).
  const showcaseTeam = async () => {
    const userIds = ["demo_user_valeria", "demo_user_marco"];
    return {
      users: await db.adminUser.count({ where: { id: { in: userIds } } }),
      memberships: await db.adminMembership.count({ where: { organizationId: showcaseId, adminUserId: { in: userIds } } }),
      avatars: await db.adminUserAvatar.count({ where: { userId: { in: userIds } } }),
    };
  };

  await t.test("QA: purgar una sandbox (a mano, por reinicio y con scripts/demo-purge.mjs) deja intactos a los colaboradores de la vitrina", async () => {
    const baseline = await showcaseTeam();
    assert.deepEqual(baseline, { users: 2, memberships: 2, avatars: 2 }, "la vitrina tiene a Valeria y Marco con membresía y avatar");

    // 1) Purga puntual (la que usan Reiniciar y DELETE).
    const one = await make("10.9.3.1");
    assert.equal(await sandboxes.purgeSandbox(one.organizationId), true);
    assert.deepEqual(await leftovers(db, one.organizationId, one.ns), [], "todo sbx_<ns>_* en 0");
    assert.equal(await db.adminUser.count({ where: { demoOrganizationId: one.organizationId } }), 0, "y sus usuarios");
    assert.deepEqual(await showcaseTeam(), baseline, "purga puntual: la vitrina conserva su equipo");
    created.splice(created.findIndex((c) => c.organizationId === one.organizationId), 1);

    // 2) Reiniciar: crea otra y purga la anterior.
    const before = await make("10.9.3.2");
    const after = await make("10.9.3.2");
    assert.equal(await sandboxes.purgeSandbox(before.organizationId), true);
    assert.deepEqual(await leftovers(db, before.organizationId, before.ns), []);
    assert.deepEqual(await showcaseTeam(), baseline, "reiniciar: la vitrina conserva su equipo");
    created.splice(created.findIndex((c) => c.organizationId === before.organizationId), 1);
    assert.ok(await db.organization.findUnique({ where: { id: after.organizationId } }), "la nueva sigue");

    // 3) El script de purga, sobre una sandbox vencida.
    await db.organization.update({ where: { id: after.organizationId }, data: { demoLastSeenAt: new Date(Date.now() - 3 * 3_600_000) } });
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, ["--import", "tsx", "scripts/demo-purge.mjs", "--limit", "50"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      encoding: "utf8",
    });
    assert.match(out, /Sandboxes borradas: [1-9]/);
    assert.deepEqual(await leftovers(db, after.organizationId, after.ns), [], "el script deja todo en 0");
    assert.deepEqual(await showcaseTeam(), baseline, "scripts/demo-purge.mjs: la vitrina conserva su equipo");
    created.splice(created.findIndex((c) => c.organizationId === after.organizationId), 1);
    sandboxLib.clearSandboxCache();
  });
});

test("demo interactiva E2: topes, 429, página llena y 20 entradas simultáneas en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { db, sandboxes, sandboxLib, resetBuckets, purgeAll } = await e2Setup();
  const sandboxIdsOf = async () => (await db.organization.findMany({ where: { isDemo: true, demoParentId: { not: null } }, select: { id: true } })).map((o) => o.id);
  t.after(async () => {
    await purgeAll();
    await resetBuckets();
  });
  await purgeAll();
  await resetBuckets();
  t.afterEach(async () => {
    await purgeAll();
    await resetBuckets();
  });

  /** Rellena con empresas sandbox vacías (sin datos): sirven para contar contra el tope. */
  const fill = async (count: number, lastSeen: Date) => {
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `sbx_fill${String(i).padStart(5, "0")}_org`,
      name: "Relleno",
      slug: `demo-fill${i}`,
      isDemo: true,
      demoParentId: "org_demo",
      demoReady: true,
      demoExpiresAt: new Date(Date.now() + 20 * 3_600_000),
      demoLastSeenAt: lastSeen,
    }));
    await db.organization.createMany({ data: rows });
    return rows.map((r) => r.id);
  };

  await t.test("15: la 5.ª creación por IP en una hora es 429; reiniciar cuenta", async () => {
    for (let i = 0; i < 4; i += 1) {
      const result = await sandboxes.createSandbox({ ip: "10.8.0.1" });
      assert.ok(result.ok, JSON.stringify(result));
    }
    const fifth = await sandboxes.createSandbox({ ip: "10.8.0.1" });
    assert.deepEqual({ ok: fifth.ok, reason: fifth.ok ? null : fifth.reason }, { ok: false, reason: "rate_ip" });
    assert.ok(!fifth.ok && (fifth.retryAfter ?? 0) > 0, "con Retry-After");
    const other = await sandboxes.createSandbox({ ip: "10.8.0.2" });
    assert.ok(other.ok, "otra IP no se ve afectada");
  });

  await t.test("15: con 150 activas no ociosas, la 151 queda «llena»; con una ociosa de más de 30 min se libera", async () => {
    await fill(150, new Date());
    const full = await sandboxes.createSandbox({ ip: "10.8.1.1" });
    assert.deepEqual({ ok: full.ok, reason: full.ok ? null : full.reason }, { ok: false, reason: "full" });
    assert.equal((await sandboxIdsOf()).length, 150, "nada se creó ni se borró");
    // Una vencida (>1 h sin uso) se purga sola y deja lugar.
    await db.organization.update({ where: { id: "sbx_fill00007_org" }, data: { demoLastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    const viaExpired = await sandboxes.createSandbox({ ip: "10.8.1.2" });
    assert.ok(viaExpired.ok, JSON.stringify(viaExpired));
    assert.equal(await sandboxes.purgeExpiredSandboxes({ limit: 5 }), 1, "la vencida no cuenta para el tope y la purga la borra");
    assert.equal(await db.organization.count({ where: { id: "sbx_fill00007_org" } }), 0);
    // Llena otra vez: solo hay una ociosa con más de 30 min (sin vencer): se la libera.
    const full2 = await sandboxes.createSandbox({ ip: "10.8.1.3" });
    assert.ok(!full2.ok && full2.reason === "full");
    await db.organization.update({ where: { id: "sbx_fill00009_org" }, data: { demoLastSeenAt: new Date(Date.now() - 40 * 60_000) } });
    const viaIdle = await sandboxes.createSandbox({ ip: "10.8.1.4" });
    assert.ok(viaIdle.ok, JSON.stringify(viaIdle));
    assert.equal(await db.organization.count({ where: { id: "sbx_fill00009_org" } }), 0, "liberó la más ociosa");
    // Una ociosa de menos de 30 min no se toca.
    await db.organization.update({ where: { id: "sbx_fill00011_org" }, data: { demoLastSeenAt: new Date(Date.now() - 20 * 60_000) } });
    const refused = await sandboxes.createSandbox({ ip: "10.8.1.5" });
    assert.ok(!refused.ok && refused.reason === "full");
    assert.equal(await db.organization.count({ where: { id: "sbx_fill00011_org" } }), 1);
  });

  await t.test("15: más de 60 altas en 15 minutos ven «llena» aunque haya lugar", async () => {
    await db.rateLimitBucket.create({ data: { id: "sbx_rl_test", key: "demo:sbx:all", windowStart: new Date(), count: 60 } });
    const result = await sandboxes.createSandbox({ ip: "10.8.2.1" });
    assert.ok(!result.ok && result.reason === "full");
  });

  await t.test("16: 20 entradas simultáneas con 140 ocupadas: entran 10, el resto ve «llena», nunca se pasa el tope ni queda nada sin sembrar", async () => {
    await fill(140, new Date());
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => sandboxes.createSandbox({ ip: `10.7.0.${i}` })));
    const ok = results.filter((r) => r.ok).length;
    const full = results.filter((r) => !r.ok && r.reason === "full").length;
    assert.equal(ok, 10, JSON.stringify(results.filter((r) => !r.ok)));
    assert.equal(full, 10);
    const active = await sandboxIdsOf();
    assert.equal(active.length, 150, "exactamente el tope");
    assert.equal(await db.organization.count({ where: { isDemo: true, demoParentId: { not: null }, demoReady: false } }), 0, "ninguna quedó sin sembrar");
    for (const r of results) if (r.ok) assert.ok((await db.client.count({ where: { organizationId: r.sandbox.organizationId } })) > 0, "sembrada");
  });

  await t.test("16: 20 entradas simultáneas sin tope cerca: las 20 quedan listas", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => sandboxes.createSandbox({ ip: `10.6.0.${i}` })));
    assert.equal(results.filter((r) => r.ok).length, 20, JSON.stringify(results.filter((r) => !r.ok)));
    assert.equal(await db.organization.count({ where: { isDemo: true, demoParentId: { not: null }, demoReady: false } }), 0);
    const ids = results.flatMap((r) => (r.ok ? [r.sandbox.organizationId] : []));
    assert.equal(new Set(ids).size, 20);
  });

  await t.test("una sandbox que nunca terminó de sembrarse se purga pasados 5 minutos", async () => {
    await db.organization.create({ data: { id: "sbx_neverready_org", name: "x", slug: "demo-neverready", isDemo: true, demoParentId: "org_demo", demoReady: false, demoExpiresAt: new Date(Date.now() + 3_600_000), demoLastSeenAt: new Date() } });
    assert.equal(await sandboxes.purgeExpiredSandboxes({ now: new Date() }), 0, "recién creada: todavía se está sembrando");
    assert.equal(await sandboxes.purgeExpiredSandboxes({ now: new Date(Date.now() + 6 * 60_000) }), 1);
    assert.equal(sandboxLib.SANDBOX_MAX_ACTIVE, 150);
  });
});
