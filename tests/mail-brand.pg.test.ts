import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/mail-brand.pg.test.ts
// El proveedor es un servidor local falso (`RESEND_BASE_URL`): nada sale a Internet.
test("correos: identidad de la empresa, remitente «vía EventOS», reply-to y logo público", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();

  const received: Array<Record<string, unknown>> = [];
  const provider = createServer((request: IncomingMessage, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `msg-${received.length}` }));
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const port = (provider.address() as { port: number }).port;
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RESEND_API_KEY = "re_test_local";
  process.env.EMAIL_FROM = "LedBox <eventoss@weem.com.py>";

  const { db } = await import("../lib/server/db");
  const sharp = (await import("sharp")).default;
  const { mailIdentityFor, platformMailIdentity } = await import("../lib/server/mail/org-brand");
  const { sendMail } = await import("../lib/server/mail/send");
  const { buildInvitationMail } = await import("../lib/server/mail/invitation");
  const { PLATFORM_BRAND } = await import("../lib/server/mail/template");
  const { GET: mailLogo } = await import("../app/api/mail/logo/[orgSlug]/[variant]/route");
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });

  async function seed(options: { name: string; contactEmail?: string | null; logo?: "light" | "dark" | null; accent?: string | null; shop?: boolean }) {
    const id = randomUUID();
    const slug = `mb-${id.slice(0, 8)}`;
    await db.organization.create({
      data: {
        id, name: options.name, slug,
        profile: {
          contact: { phone: "+595 21 555 000", whatsapp: "+595981123456", instagram: "lavajilla.py", email: options.contactEmail ?? null, website: null, phone2: null },
          location: { address: "Av. España 1234", city: "Asunción", neighborhood: "Villa Morra", mapsUrl: "https://maps.app.goo.gl/lavajilla" },
        },
      },
    });
    await db.organizationRentalSettings.create({
      data: { id: randomUUID(), organizationId: id, publicCatalogEnabled: options.shop ?? false, storefrontAccent: options.accent ?? null },
    });
    if (options.logo) {
      const data = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
      await db.organizationLogo.create({ data: { id: randomUUID(), organizationId: id, variant: options.logo, mime: "image/png", size: data.length, width: 300, height: 100, data } });
    }
    return { id, slug };
  }

  try {
    await t.test("empresa con logo, color y contacto: marca completa, From «<Empresa> vía EventOS» y reply-to de la empresa", async () => {
      const org = await seed({ name: "La Vajilla", contactEmail: "Hola@LaVajilla.example", logo: "light", accent: "#0b5cd5" });
      const identity = await mailIdentityFor(org.id);
      assert.equal(identity.from, "La Vajilla vía EventOS <eventoss@weem.com.py>");
      assert.equal(identity.replyTo, "hola@lavajilla.example");
      assert.equal(identity.brand.name, "La Vajilla");
      assert.equal(identity.brand.color, "#0b5cd5");
      assert.equal(identity.brand.logoOnPlate, true, "solo hay la variante clara: va sobre chapa negra");
      assert.ok(identity.brand.logoUrl?.endsWith(`/api/mail/logo/${org.slug}/light`), "logo por la ruta de correos aunque la tienda esté apagada");
      assert.equal(identity.brand.contact?.address, "Av. España 1234, Villa Morra, Asunción");
      assert.equal(identity.brand.contact?.mapsUrl, "https://maps.app.goo.gl/lavajilla");

      const content = buildInvitationMail({ organizationName: "La Vajilla", brand: identity.brand, email: "ana@example.test", role: "VIEWER", invitedByName: "Dueña", token: "TOKEN", expiresAt: new Date(Date.now() + 86_400_000) });
      received.length = 0;
      const result = await sendMail({ to: "ana@example.test", subject: content.subject, category: "invitation", html: content.html, text: content.text, organizationId: org.id });
      assert.equal(result.status, "sent", result.error);
      assert.equal(received.length, 1);
      assert.equal(received[0].from, "La Vajilla vía EventOS <eventoss@weem.com.py>");
      assert.equal(received[0].reply_to, "hola@lavajilla.example");
      assert.ok(!/ledbox/i.test(String(received[0].html).replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " ")), "el correo de La Vajilla no dice LedBox");
    });

    await t.test("sin correo de contacto no hay reply-to; sin logo ni color solo el nombre; la tienda apagada no oculta el logo del correo", async () => {
      const org = await seed({ name: "Eventos Sur", contactEmail: null });
      const identity = await mailIdentityFor(org.id);
      assert.equal(identity.replyTo, null);
      assert.equal(identity.brand.logoUrl, null);
      assert.equal(identity.brand.color, null);
      received.length = 0;
      await sendMail({ to: "ana@example.test", subject: "Hola", category: "test", html: "<p>x</p>", text: "x", organizationId: org.id });
      assert.equal(received[0].from, "Eventos Sur vía EventOS <eventoss@weem.com.py>");
      assert.equal("reply_to" in received[0], false, "no se inventa un reply-to");

      const withLogo = await seed({ name: "Solo Oscuro", logo: "dark" });
      const dark = await mailIdentityFor(withLogo.id);
      assert.equal(dark.brand.logoOnPlate, false, "la variante para fondo claro va directa sobre el blanco");
      const ok = await mailLogo(new Request("http://x"), params({ orgSlug: withLogo.slug, variant: "dark" }));
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("content-type"), "image/png");
      assert.equal((await mailLogo(new Request("http://x"), params({ orgSlug: withLogo.slug, variant: "light" }))).status, 404, "esa variante no existe");
      assert.equal((await mailLogo(new Request("http://x"), params({ orgSlug: "no-existe", variant: "dark" }))).status, 404);
      assert.equal((await mailLogo(new Request("http://x"), params({ orgSlug: withLogo.slug, variant: "../x" }))).status, 404);
    });

    await t.test("el logo es de ESA empresa: otra empresa no lo ve con su slug", async () => {
      const a = await seed({ name: "Empresa A", logo: "light" });
      const b = await seed({ name: "Empresa B" });
      assert.equal((await mailLogo(new Request("http://x"), params({ orgSlug: b.slug, variant: "light" }))).status, 404);
      assert.equal((await mailLogo(new Request("http://x"), params({ orgSlug: a.slug, variant: "light" }))).status, 200);
      await db.organization.update({ where: { id: a.id }, data: { active: false } });
      assert.equal((await mailLogo(new Request("http://x"), params({ orgSlug: a.slug, variant: "light" }))).status, 404, "empresa desactivada");
    });

    await t.test("correos de plataforma salen como «EventOS» y sin reply-to, aunque lleven empresa para el historial", async () => {
      const org = await seed({ name: "La Vajilla", contactEmail: "hola@lavajilla.example" });
      assert.deepEqual(platformMailIdentity(), { brand: PLATFORM_BRAND, from: "EventOS <eventoss@weem.com.py>", replyTo: null });
      received.length = 0;
      const result = await sendMail({ to: "dueño@example.test", subject: "Alta", category: "invitation", html: "<p>x</p>", text: "x", organizationId: org.id, platform: true });
      assert.equal(result.status, "sent", result.error);
      assert.equal(received[0].from, "EventOS <eventoss@weem.com.py>");
      assert.equal("reply_to" in received[0], false);
      const log = await db.mailLog.findUniqueOrThrow({ where: { id: result.logId! } });
      assert.equal(log.organizationId, org.id, "el historial sigue siendo de la empresa");
    });

    await t.test("una empresa inexistente o una falla de lectura nunca rompe el envío: sale como EventOS", async () => {
      const identity = await mailIdentityFor(randomUUID());
      assert.equal(identity.from, "EventOS <eventoss@weem.com.py>");
      assert.equal(identity.brand.platform, true);
    });
  } finally {
    provider.close();
    await db.$disconnect();
  }
});
