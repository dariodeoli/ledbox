import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMail, renderMailText } from "../lib/server/mail/template";
import { buildInvitationMail } from "../lib/server/mail/invitation";
import { buildSignatureRequestMail, buildSignatureCompletedMail, buildSignatureReminderMail, buildSignatureOtpMail } from "../lib/server/mail/signature";
import { inspectMail, fullContent } from "./mail-theme-contrast.test";
import { APP_VERSION_LABEL } from "../lib/version";

const untrusted = '<img src=x onerror="fail"> & texto';
const signatureInput = { organizationName: "Empresa offline", title: untrusted, recipientName: "Persona", senderName: "Equipo", code: "TEST-ONLY", portalUrl: "https://example.invalid/sign?x=1&y=2", expiresAt: new Date("2026-12-01T12:00:00Z"), methodLabel: "Firma", message: untrusted };
const renders = [
  ["shared complete", () => ({ html: renderMail({ ...fullContent, title: untrusted }), text: renderMailText({ ...fullContent, title: untrusted }) })],
  ["invitation", () => buildInvitationMail({ organizationName: untrusted, email: "fixture@example.invalid", role: "VIEWER", invitedByName: "Equipo", token: "test-only-token", expiresAt: signatureInput.expiresAt })],
  ["signature request", () => buildSignatureRequestMail(signatureInput)],
  ["signature completed", () => buildSignatureCompletedMail({ ...signatureInput, identifier: "fixture-id", signedAt: signatureInput.expiresAt })],
  ["signature reminder", () => buildSignatureReminderMail({ ...signatureInput, daysLeft: 1 })],
  ["signature OTP", () => buildSignatureOtpMail({ ...signatureInput, expiresInMinutes: 10 })],
] as const;

for (const [name, build] of renders) {
  test(`${name}: real HTML and plaintext preserve escaped untrusted content`, () => {
    const { html, text } = build();
    assert.ok(text.includes(untrusted)); assert.ok(html.includes("&lt;img src=x onerror=&quot;fail&quot;&gt; &amp; texto"));
    assert.equal(html.includes('<img src=x onerror="fail">'), false);
    assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
    assert.ok(html.includes(APP_VERSION_LABEL), "footer uses this composition's real version");
  });
  test(`${name}: explicit light/dark and OGSC overrides change actual painted pairs`, () => {
    const { html } = build();
    assert.match(html, /name="color-scheme" content="light dark"/);
    assert.match(html, /name="supported-color-schemes" content="light dark"/);
    assert.match(html, /@media\s*\([^)]*prefers-color-scheme\s*:\s*dark/);
    assert.match(html, /\[data-ogsc\]/);
    const light = inspectMail(html, "light"), dark = inspectMail(html, "dark"), ogsc = inspectMail(html, "ogsc");
    assert.equal(light.records.length, dark.records.length); assert.equal(dark.records.length, ogsc.records.length);
    assert.ok(light.records.some((record, index) => record.background !== dark.records[index].background), "real dark surfaces painted");
    for (let index = 0; index < dark.records.length; index++) {
      assert.equal(ogsc.records[index].foreground, dark.records[index].foreground, `OGSC foreground ${index}`);
      assert.equal(ogsc.records[index].background, dark.records[index].background, `OGSC background ${index}`);
    }
    for (const mode of [light, dark, ogsc]) {
      const failing = mode.records.filter(record => record.ratio < record.minimum);
      assert.deepEqual(failing.map(record => ({ text: record.text.slice(0, 60), ratio: record.ratio, minimum: record.minimum })), []);
    }
  });
}

for (const width of [320, 390]) test(`actual long-content mobile CSS at ${width}px preserves wrapping and touch target`, () => {
  const html = renderMail({ ...fullContent, title: untrusted.repeat(10), rows: [{ label: "Artículo".repeat(30), value: "Detalle".repeat(40) }] });
  const { nodes, records, style } = inspectMail(html, "light", width);
  const card = nodes.find(node => (node.attrs.class ?? "").split(/\s+/).includes("lb-card"));
  assert.ok(card); assert.equal(style(card).width, "100%");
  const button = nodes.find(node => (node.attrs.class ?? "").split(/\s+/).includes("lb-btn"));
  assert.ok(button); const buttonStyle = style(button);
  assert.equal(buttonStyle.display, "block");
  const padding = (buttonStyle.padding ?? "").split(/\s+/).map(parseFloat);
  assert.ok(Number.isFinite(padding[0]) && padding[0] * 2 + parseFloat(buttonStyle["font-size"]) >= 44, "minimum CTA height from font plus vertical padding");
  for (const record of records.filter(r => r.text.length > 100)) {
    let node = record.node, wraps = false;
    while (node) {
      const values = style(node);
      if (["break-word", "break-all"].includes(values["word-break"]) || ["anywhere", "break-word"].includes(values["overflow-wrap"])) wraps = true;
      assert.notEqual(values["white-space"], "nowrap", `long text forced nowrap: ${record.text.slice(0, 50)}`);
      node = node.parent!;
    }
    assert.ok(wraps, `long text has no emitted break rule: ${record.text.slice(0, 50)}`);
  }
});

test("actual colored shared surfaces use both important dark paths, VML keeps its explicit pair", () => {
  const html = renderMail(fullContent), light = inspectMail(html, "light"), dark = inspectMail(html, "dark"), ogsc = inspectMail(html, "ogsc");
  for (const role of ["lb-canvas", "lb-card", "lb-content", "lb-header", "lb-summary", "lb-footer", "lb-note", "lb-cta-surface", "lb-btn"]) {
    const node = light.nodes.find(n => (n.attrs.class ?? "").split(/\s+/).includes(role)); assert.ok(node, `${role} emitted`);
    const index = light.nodes.indexOf(node), darkNode = dark.nodes[index], ogscNode = ogsc.nodes[index];
    assert.notEqual(light.style(node)["background-color"], dark.style(darkNode)["background-color"], `${role} actual dark paint`);
    assert.equal(dark.style(darkNode)["background-color"], ogsc.style(ogscNode)["background-color"], `${role} OGSC pair`);
    assert.match(dark.css, new RegExp(`\\.${role}[^{}]*\\{[^}]*background-color:[^;}]+!important`), `${role} overrides inline background`);
  }
  const vml = light.nodes.find(n => n.tag === "v:roundrect"); assert.ok(vml?.attrs.fillcolor);
  const center = light.records.find(r => r.node.tag === "center"); assert.ok(center);
  assert.equal(center.background, vml.attrs.fillcolor); assert.ok(center.ratio >= 4.5);
  assert.match(html, /mso-fit-shape-to-text:true/);
});

// These actual modules reach DB/audit/send imports in this source. No mocked
// palette or extraction of their body is substituted for a real callable render.
test("budget caller actual render", { skip: "NOT_RUN: budget.ts -> budget-portal.ts -> db; owner pure caller source not supplied" }, () => {});
test("payment reminder caller actual render", { skip: "NOT_RUN: reminders.ts -> db/audit/mail send; owner pure caller source not supplied" }, () => {});
test("system alert caller actual render", { skip: "NOT_RUN: system-status.ts -> db/audit/mail send and private backup inputs; owner pure caller source not supplied" }, () => {});
