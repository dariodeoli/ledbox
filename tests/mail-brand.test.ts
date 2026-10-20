import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { contrastRatio, readableOn } from "../lib/storefront-theme";
import { publicConfig } from "../lib/public-config";
import { APP_VERSION_LABEL } from "../lib/version";
import { buildAccessApprovedMail, buildOrderRejectedMail } from "../lib/server/mail/catalog";
import { buildInvitationMail } from "../lib/server/mail/invitation";
import { buildSignatureOtpMail, buildSignatureRequestMail } from "../lib/server/mail/signature";
import { PLATFORM_BRAND, renderMail, renderMailText, type MailBrand } from "../lib/server/mail/template";
import { formatSender } from "../lib/server/mail/transport";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const expiresAt = new Date("2026-12-01T12:00:00Z");

/** Empresa de ejemplo (no es LedBox): con logo, color y contacto completos. */
const vajilla: MailBrand = {
  name: "La Vajilla",
  color: "#0b5cd5",
  logoUrl: "https://eventos.example.test/api/mail/logo/la-vajilla/light",
  logoWidth: 300,
  logoHeight: 100,
  contact: {
    phone: "+595 21 555 000",
    whatsapp: "+595 981 123 456",
    instagram: "lavajilla.py",
    email: "hola@lavajilla.example",
    website: "https://lavajilla.example",
    address: "Av. España 1234, Villa Morra, Asunción",
    mapsUrl: "https://maps.app.goo.gl/lavajilla",
  },
};

/** Solo lo que lee una persona: sin etiquetas ni URLs (los enlaces pueden llevar el dominio de la plataforma). */
function visible(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " ");
}

const content = {
  title: "Presupuesto de ejemplo",
  intro: ["Hola Ana,", "Te compartimos el detalle."],
  rows: [{ label: "Total", value: "Gs. 1.500.000", strong: true }, { label: "Válido hasta", value: "01/12/2026" }],
  cta: { label: "Revisar presupuesto", url: "https://clientes.example.test/p/ABCD" },
  note: "Si no esperabas este correo, ignorarlo es seguro.",
  organization: "La Vajilla",
  reason: "te enviamos un presupuesto",
};

test("correo de empresa: marca EventOS + logo y nombre de la empresa, contacto en el pie y «Enviado con EventOS»", () => {
  const html = renderMail({ ...content, brand: vajilla });
  assert.match(html, /<img[^>]*src="[^"]*\/assets\/eventos-mark\.png"[^>]*alt="EventOS"/, "isotipo de EventOS en el encabezado");
  assert.match(html, /<img[^>]*src="https:\/\/eventos\.example\.test\/api\/mail\/logo\/la-vajilla\/light"[^>]*alt="La Vajilla"/, "logo de la empresa con alt");
  assert.match(html, /width="90" height="30"/, "el logo reserva su proporción (Outlook)");
  const header = html.slice(html.indexOf('class="lb-header'), html.indexOf('class="lb-content'));
  assert.ok(header.indexOf("/logo/la-vajilla") < header.indexOf("eventos-mark.png"), "logo y nombre de la empresa a la izquierda, isotipo EventOS a la derecha");
  assert.ok(header.includes(">La Vajilla<"), "nombre de la empresa en el encabezado");
  const footer = html.slice(html.indexOf('class="lb-footer'));
  assert.ok(footer.includes('href="tel:+595215550'.slice(0, 18)), "teléfono");
  assert.ok(footer.includes('href="https://wa.me/595981123456"'), "WhatsApp");
  assert.ok(footer.includes('href="https://www.instagram.com/lavajilla.py"') && footer.includes("@lavajilla.py"), "Instagram");
  assert.ok(footer.includes('href="mailto:hola@lavajilla.example"'), "correo de contacto");
  assert.ok(footer.includes('href="https://maps.app.goo.gl/lavajilla"') && footer.includes("Av. España 1234"), "dirección con Maps");
  assert.ok(footer.includes("Enviado con <strong>EventOS</strong>"), "pie de EventOS");
  assert.ok(!/ledbox/i.test(visible(html)), "un correo de La Vajilla no dice LedBox");
  const text = renderMailText({ ...content, brand: vajilla });
  assert.ok(text.startsWith("La Vajilla · vía EventOS"));
  assert.ok(text.includes("@lavajilla.py") && text.includes("Av. España 1234") && text.includes("Enviado con EventOS"));
  assert.ok(!/ledbox/i.test(text.replace(/https?:\/\/\S+/g, " ")), "el texto plano tampoco");
});

test("el color de marca va solo en el botón y los acentos, con texto legible; sin color rige el acento de EventOS", () => {
  const html = renderMail({ ...content, brand: vajilla });
  const button = /<a class="lb-btn-brand"[^>]*style="[^"]*background:(#[0-9a-f]{6});color:(#[0-9a-f]{6});/.exec(html);
  assert.ok(button, "botón con el color de la empresa");
  assert.equal(button[1], "#0b5cd5");
  assert.equal(button[2], readableOn("#0b5cd5"));
  assert.ok(contrastRatio(button[1], button[2]) >= 4.5, "contraste AA del botón");
  assert.equal(html.split("#0b5cd5").length - 1, 4, "el color de la empresa solo está en el botón (HTML y VML de Outlook)");
  assert.ok(!/border-bottom:4px|linear-gradient/.test(html), "sin bandas ni degradés");
  const dull = renderMail({ ...content, brand: { ...vajilla, color: "#ffe066" } });
  assert.match(dull, /<a class="lb-btn"[^>]*background:#111111;color:#ffffff/, "color sin contraste: botón negro");
  assert.ok(html.includes("Si el botón no abre, copiá este enlace"), "link alternativo en texto");
  const neutral = renderMail({ ...content, brand: { ...vajilla, color: null } });
  assert.ok(!neutral.includes("#0b5cd5"));
  assert.match(neutral, /<a class="lb-btn"[^>]*background:#111111;color:#ffffff/, "sin color de marca: negro con texto blanco");
});

test("sin logo solo sale el nombre; sin contacto cargado no se inventa ninguno", () => {
  const html = renderMail({ ...content, brand: { name: "Eventos Sur" } });
  assert.ok(!html.includes("/logo/"), "sin logo no hay imagen de empresa");
  assert.match(html, /font:600 16px[^>]*>Eventos Sur</, "nombre en semibold");
  const footer = html.slice(html.indexOf('class="lb-footer'));
  assert.ok(!/tel:|wa\.me|instagram|mailto:|maps/i.test(footer), "sin datos, sin enlaces de contacto");
  assert.ok(!visible(footer).includes("Asunción"), "la dirección de la plataforma no se le presta a la empresa");
});

test("correo de plataforma sale como EventOS; LedBox como empresa conserva su propio nombre", () => {
  const platform = renderMail({ ...content, organization: null, brand: PLATFORM_BRAND });
  assert.ok(visible(platform).includes("EventOS") && !/ledbox/i.test(visible(platform)));
    const asCompany = renderMail({ ...content, organization: "LedBox", brand: { name: "LedBox", logoUrl: "https://eventos.example.test/api/mail/logo/ledbox/light" } });
  assert.ok(visible(asCompany).includes("LedBox"), "LedBox como empresa dice su nombre");
  assert.ok(asCompany.includes('alt="LedBox"'));
  assert.ok(renderMailText({ ...content, organization: null }).startsWith("EventOS"), "sin empresa ni marca: EventOS");
});

test("ningún correo de empresa dice «LedBox» cuando la empresa no es LedBox", () => {
  const common = { organizationName: "La Vajilla", title: "Salón", recipientName: "Ana", senderName: "Equipo", code: "234567", portalUrl: "https://clientes.example.test/f/1", expiresAt, methodLabel: "Firma", brand: vajilla };
  const mails: Record<string, { html: string; text: string; subject: string }> = {
    invitation: buildInvitationMail({ organizationName: "La Vajilla", email: "x@example.test", role: "VIEWER", invitedByName: "Equipo", token: "TOKEN", expiresAt, brand: vajilla }),
    signatureRequest: buildSignatureRequestMail(common),
    signatureOtp: buildSignatureOtpMail({ ...common, expiresInMinutes: 10 }),
    accessApproved: buildAccessApprovedMail({ organizationName: "La Vajilla", name: "Ana", url: "https://eventos.example.test/c/x", kind: "RETAIL", brand: vajilla }),
    orderRejected: buildOrderRejectedMail({ organizationName: "La Vajilla", name: "Ana", reason: "Sin stock", trackingUrl: "https://eventos.example.test/p/x", brand: vajilla }),
    generic: { ...content, brand: vajilla, html: renderMail({ ...content, brand: vajilla }), text: renderMailText({ ...content, brand: vajilla }), subject: content.title } as never,
  };
  for (const [name, mail] of Object.entries(mails)) {
    for (const [part, value] of [["asunto", mail.subject], ["html", visible(mail.html)], ["texto", mail.text.replace(/https?:\/\/\S+/g, " ")]]) {
      assert.ok(!/ledbox/i.test(value), `${name}: el ${part} dice LedBox`);
    }
    assert.ok(mail.html.includes('alt="La Vajilla"') && mail.html.includes("Enviado con <strong>EventOS</strong>"), `${name}: plantilla única con marca de la empresa`);
  }
});

test("remitente: «<Empresa> vía EventOS» con el dominio configurado; plataforma como «EventOS»; nombres hostiles se limpian", () => {
  const previous = process.env.EMAIL_FROM;
  process.env.EMAIL_FROM = "LedBox <eventoss@weem.com.py>";
  try {
    assert.equal(formatSender("La Vajilla"), "La Vajilla vía EventOS <eventoss@weem.com.py>");
    assert.equal(formatSender(null), "EventOS <eventoss@weem.com.py>");
    assert.equal(formatSender("   "), "EventOS <eventoss@weem.com.py>");
    assert.equal(formatSender('Eventos "Sur"'), "Eventos Sur vía EventOS <eventoss@weem.com.py>");
    const hostile = formatSender('Mala\r\nBcc: robo@x.test');
    assert.ok(!/[\r\n]/.test(hostile) && hostile.endsWith("<eventoss@weem.com.py>"), "sin saltos de línea en el encabezado");
    assert.ok(formatSender("Casa, Fiestas") .startsWith('"Casa, Fiestas vía EventOS"'), "comas entre comillas");
    process.env.EMAIL_FROM = "soporte@weem.com.py";
    assert.equal(formatSender("La Vajilla"), "La Vajilla vía EventOS <soporte@weem.com.py>");
  } finally {
    if (previous === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = previous;
  }
});

/** Archivos `.ts` bajo `dir` (sin JSX): ahí no puede haber HTML de correo armado a mano. */
function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

test("un correo nuevo no puede armar HTML sin la plantilla única", () => {
  const html = /<!(?:doctype|DOCTYPE) html|<html[\s>]|<table[\s>]|<tr[\s>]|<td[\s>]|<body[\s>]|<h1[\s>]/;
  // The OAuth consent screen is HTML, but it is not an email template or email dispatch.
  const allowed = new Set(["lib/server/mail/template.ts", "app/api/demo/session/route.ts", "app/oauth/authorize/route.ts"]);
  const offenders = [...sources("lib"), ...sources("app")]
    .filter((path) => !allowed.has(path))
    .filter((path) => html.test(readFileSync(join(root, path), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  assert.deepEqual(offenders, [], "el HTML de correo vive solo en lib/server/mail/template.ts (renderMail)");
  assert.ok(sources("lib/server/mail").includes("lib/server/mail/template.ts"));
});

test("el código de los correos no escribe «LedBox» como marca (la empresa o EventOS la pone la plantilla)", () => {
  const files = [...sources("lib/server/mail"), "lib/server/reminders.ts", "lib/server/resend.ts", "lib/server/system-status.ts", "lib/platform/alta-empresa-server.ts"];
  const offenders = files.filter((path) => /ledbox/i.test(readFileSync(join(root, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/"ledbox:[a-z-]+"/g, "")));
  assert.deepEqual(offenders, []);
});

// ---- Snapshots del HTML (se regeneran con UPDATE_SNAPSHOTS=1; versión y host se normalizan) ----
function normalize(html: string): string {
  return html.replaceAll(APP_VERSION_LABEL, "{{version}}").replaceAll(publicConfig.siteUrl, "{{site}}").replaceAll(publicConfig.adminUrl, "{{admin}}");
}
function snapshot(name: string, value: string) {
  const file = join(root, "tests/__snapshots__", `${name}.html`);
  const actual = normalize(value);
  if (process.env.UPDATE_SNAPSHOTS === "1" || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
  }
  assert.equal(actual, readFileSync(file, "utf8"), `${name}: el HTML cambió; revisá la vista previa y regenerá con UPDATE_SNAPSHOTS=1`);
}

test("snapshot: presupuesto de una empresa, invitación de empresa y correo de plataforma", () => {
  snapshot("mail-presupuesto-empresa", renderMail({
    ...content, eyebrow: "Presupuesto · decisión del cliente", status: { label: "Requiere revisión", tone: "accent" },
    preheader: "Gs. 1.500.000", brand: vajilla,
  }));
  snapshot("mail-invitacion-empresa", buildInvitationMail({
    organizationName: "La Vajilla", email: "x@example.test", role: "OPERATIONS", invitedByName: "Dueña", token: "TOKENDEEJEMPLO", expiresAt, brand: vajilla, now: new Date("2026-10-15T12:00:00Z"),
  }).html);
  snapshot("mail-plataforma", renderMail({
    title: "Restablecé tu contraseña", intro: "Solicitaste restablecer tu contraseña de EventOS.",
    cta: { label: "Restablecer contraseña", url: "https://admin.example.test/reset" }, note: "El enlace vence en 30 minutos.",
    brand: PLATFORM_BRAND, reason: "solicitaste restablecer tu contraseña de EventOS",
  }));
});
