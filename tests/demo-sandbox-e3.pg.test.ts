import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/demo-sandbox-e3.pg.test.ts

function localDb() {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
}

// ── E3: correo simulado y OTP solo en sandbox (criterios 6 y 18) ────────────────────────────────────────
test("demo interactiva E3: correo simulado con vista previa y OTP en pantalla solo en una sandbox", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  localDb();
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
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

  const { db } = await import("../lib/server/db");
  const sandboxLib = await import("../lib/server/demo-sandbox");
  const sandboxes = await import("../lib/server/demo-sandboxes");
  const { sendMail } = await import("../lib/server/mail/send");
  const { sendSignatureOtp, verifySignatureOtp, signatureClientEvidence } = await import("../lib/server/signature/portal");
  const { publicConfig } = await import("../lib/public-config");
  const { SANDBOX_IDLE_LIMIT_MS } = await import("../lib/demo-deadline");
  assert.equal(SANDBOX_IDLE_LIMIT_MS, sandboxLib.SANDBOX_IDLE_MS, "la franja y el servidor hablan de la misma hora");

  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "demo:sbx:" } } });
  const created = await sandboxes.createSandbox({ ip: `10.${Math.floor(Math.random() * 200)}.1.1` });
  assert.ok(created.ok, "se pudo crear la sandbox");
  const sandbox = (created as { ok: true; sandbox: { organizationId: string } }).sandbox;
  t.after(async () => {
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await sandboxes.purgeSandbox(sandbox.organizationId).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: sandbox.organizationId } });
    sandboxLib.clearSandboxCache();
  });

  const html = `<a href="${publicConfig.clientUrl}/p/ABCD">Ver presupuesto</a>`;
  await t.test("sandbox: no llega al proveedor, queda MailLog skipped y la vista previa lleva el host demo", async () => {
    const hits = providerHits;
    const result = await sendMail({ to: "cliente@empresa.com", subject: "Tu presupuesto", category: "budget", html, text: `Ver ${publicConfig.clientUrl}/p/ABCD`, organizationId: sandbox.organizationId });
    assert.equal(providerHits, hits, "0 llamadas al proveedor");
    assert.equal(result.status, "skipped");
    assert.equal(result.simulated, true);
    assert.equal(result.preview?.subject, "Tu presupuesto");
    assert.equal(result.preview?.to, "cliente@empresa.com");
    assert.ok(result.preview?.html.includes(`${publicConfig.demoUrl}/p/ABCD`), "el link usa el host de la demo");
    assert.ok(!result.preview?.html.includes(publicConfig.clientUrl) || publicConfig.clientUrl === publicConfig.demoUrl, "no queda el host clientes.");
    assert.ok(result.preview?.text.includes(`${publicConfig.demoUrl}/p/ABCD`));
    const log = await db.mailLog.findUnique({ where: { id: result.logId! } });
    assert.equal(log?.status, "skipped");
    assert.equal(log?.error, "Demo: simulado");
  });

  const realOrg = `org-${randomUUID().slice(0, 8)}`;
  await db.organization.create({ data: { id: realOrg, name: "Real E3", slug: `real-${realOrg}` } });
  t.after(async () => {
    await db.mailLog.deleteMany({ where: { organizationId: realOrg } });
    await db.organization.deleteMany({ where: { id: realOrg } });
  });
  await t.test("empresa real: se envía igual, sin simulación; un destino *.demo no sale y tampoco expone vista previa", async () => {
    const sent = await sendMail({ to: "cliente@empresa.com", subject: "Real", category: "budget", html, organizationId: realOrg });
    assert.equal(sent.status, "sent");
    assert.equal(sent.simulated, undefined);
    assert.equal(sent.preview, undefined);
    const hits = providerHits;
    const demoDest = await sendMail({ to: "cliente@tigo.demo", subject: "Real", category: "budget", html, organizationId: realOrg });
    assert.equal(providerHits, hits, "un destino *.demo nunca sale");
    assert.equal(demoDest.simulated, true);
    assert.equal(demoDest.preview, undefined, "la vista previa solo existe en una sandbox");
  });

  await t.test("OTP de firma: la sandbox lo devuelve para mostrarlo en pantalla y funciona; una empresa real nunca lo expone", async () => {
    const request = await db.signatureRequest.findFirst({ where: { organizationId: sandbox.organizationId, status: { in: ["SENT", "VIEWED"] } } });
    assert.ok(request, "el seed trae una solicitud activa");
    await db.signatureRequest.update({ where: { id: request.id }, data: { otpRequired: true, recipientEmail: "cliente@empresa.com", expiresAt: new Date(Date.now() + 86_400_000) } });
    const evidence = signatureClientEvidence(new Headers({ "user-agent": "test", "x-forwarded-for": "190.1.1.1" }));

    const hits = providerHits;
    const view = await sendSignatureOtp({ code: request.publicCode, evidence });
    assert.equal(providerHits, hits, "no se envía ningún correo");
    assert.match(String(view.demoOtp), /^\d{6}$/, "la sandbox muestra el código en pantalla");
    await verifySignatureOtp({ code: request.publicCode, evidence, otp: view.demoOtp! });
    assert.ok((await db.signatureRequest.findUnique({ where: { id: request.id } }))?.otpVerifiedAt, "el código mostrado verifica");

    // La misma solicitud, ahora en una empresa que NO es sandbox: nunca expone el código.
    await db.signatureRequest.update({ where: { id: request.id }, data: { otpVerifiedAt: null, otpCodeHash: null } });
    await db.organization.update({ where: { id: sandbox.organizationId }, data: { isDemo: false, demoParentId: null } });
    sandboxLib.clearSandboxCache();
    const realView = await sendSignatureOtp({ code: request.publicCode, evidence });
    assert.equal(providerHits, hits + 1, "en una empresa real el correo sale de verdad");
    assert.equal("demoOtp" in realView, false, "una empresa real no expone el código");
    // Y con un destino *.demo (simulado, pero empresa real): falla cerrado, sin código.
    await db.signatureRequest.update({ where: { id: request.id }, data: { recipientEmail: "cliente@tigo.demo" } });
    await assert.rejects(() => sendSignatureOtp({ code: request.publicCode, evidence }), (error: { status?: number }) => error.status === 502);
    assert.equal(providerHits, hits + 1, "un destino *.demo no sale");
    // Se restituye para que la purga de cierre vea una sandbox.
    await db.organization.update({ where: { id: sandbox.organizationId }, data: { isDemo: true, demoParentId: "org_demo" } });
    sandboxLib.clearSandboxCache();
  });
});
