import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { SANDBOX_IDLE_LIMIT_MS, sandboxDeadline } from "../lib/demo-deadline";
import { comparisonPortalUrl, portalBudgetUrl, portalOrigin, publicConfig, rebasePortalLinks, setPortalSandbox, signaturePortalUrl } from "../lib/public-config";
import { demoOtpToExpose } from "../lib/server/signature/portal";

/**
 * Demo interactiva E3 (docs/DEMO-INTERACTIVA.md §3 y §7, criterios 19 y 21): franja, links con el host demo,
 * vista simulada del correo y de WhatsApp, portal demo, OTP en pantalla y accesos que una sandbox no tiene.
 * Lo que necesita Postgres vive en `demo-sandbox-e3.pg.test.ts`.
 */

const root = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", ".claude", "qa-local"]);
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const read = (path: string) => readFileSync(join(root, path), "utf8");
const src = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("franja: texto, Reiniciar con AdminConfirmDialog, Salir, hora límite y aviso de demo vencida", () => {
  const strip = src("components/admin/AdminSandboxStrip.tsx");
  assert.ok(strip.includes("Tus cambios se borran si no la usás por 1 hora"));
  assert.ok(strip.includes("DEMO ·") || strip.includes("<strong>DEMO</strong>"));
  assert.ok(strip.includes("Reiniciar la demo"));
  assert.ok(strip.includes("AdminConfirmDialog"), "reiniciar pide confirmación");
  assert.ok(!/\bconfirm\(|\balert\(/.test(strip), "sin cuadros nativos");
  assert.ok(strip.includes('"/api/demo/session?reset=1"') && strip.includes('method: "POST"'));
  assert.ok(strip.includes("window.location.assign"), "recarga con la sandbox nueva");
  assert.ok(strip.includes("Salir"));
  assert.ok(strip.includes("Tu demo anterior venció; empezaste una nueva"));
  assert.ok(strip.includes("hora de Paraguay") && strip.includes("sandboxDeadline"));
  // El aviso es la cookie legible que escribe el servidor.
  const route = read("app/api/demo/session/route.ts");
  assert.ok(route.includes('const NOTICE_COOKIE = "ledbox_demo_aviso"'));
  assert.ok(strip.includes('"ledbox_demo_aviso"'));
  assert.ok(strip.includes("Max-Age=0"), "el aviso se borra");
  // Reusa la franja de la vitrina.
  assert.ok(strip.includes("admin-demo-strip"));
});

test("franja: el shell la dibuja solo con session.sandbox y 'Salir' también sale de la demo", () => {
  const shell = src("components/admin/AdminShell.tsx");
  assert.match(shell, /session\.sandbox \? \(\s*<AdminSandboxStrip/);
  assert.ok(shell.includes("demoLastSeenAt") && shell.includes("demoExpiresAt"));
  assert.match(shell, /if \(session\.demo \|\| session\.sandbox\) \{\s*await exitDemo\(\)/, "cerrar sesión en una sandbox es salir de la demo");
  assert.ok(shell.includes("setPortalSandbox(sandbox)"), "el shell avisa que los links del portal van al host demo");
});

test("sesión: expone demoLastSeenAt y demoExpiresAt solo en una sandbox", () => {
  const session = src("lib/server/admin-session.ts");
  assert.match(session, /sandbox\s*\?\s*await db\.organization\.findUnique/);
  assert.match(session, /\.\.\.\(sandboxTimes/);
  assert.ok(session.includes("demoLastSeenAt") && session.includes("demoExpiresAt"));
});

test("hora límite: 1 h sin uso o el tope de 24 h, lo que llegue primero; sin datos no se inventa", () => {
  const last = "2026-10-14T15:00:00.000Z";
  assert.equal(sandboxDeadline({ lastSeenAt: last, expiresAt: "2026-10-15T10:00:00.000Z" })?.toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(sandboxDeadline({ lastSeenAt: last, expiresAt: "2026-10-14T15:20:00.000Z" })?.toISOString(), "2026-10-14T15:20:00.000Z", "el tope de 24 h manda si es antes");
  assert.equal(sandboxDeadline({ lastSeenAt: last })?.toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(sandboxDeadline({}), null);
  assert.equal(sandboxDeadline({ lastSeenAt: "no-es-fecha" }), null);
  assert.equal(SANDBOX_IDLE_LIMIT_MS, 3_600_000);
});

test("links: portal, firma y comparativa usan el host demo en una sandbox y clientes. en una empresa real", () => {
  assert.notEqual(publicConfig.clientUrl, publicConfig.demoUrl);
  assert.equal(portalBudgetUrl("ABCD", { sandbox: true }), `${publicConfig.demoUrl}/p/ABCD`);
  assert.equal(portalBudgetUrl("ABCD", { sandbox: false }), `${publicConfig.clientUrl}/p/ABCD`);
  assert.equal(portalBudgetUrl("ABCD"), `${publicConfig.clientUrl}/p/ABCD`, "sin aviso de sandbox (servidor) es clientes.");
  assert.equal(signaturePortalUrl("X", { sandbox: true }), `${publicConfig.demoUrl}/firma/X`);
  assert.equal(signaturePortalUrl("X"), `${publicConfig.clientUrl}/firma/X`);
  assert.equal(comparisonPortalUrl("t k", { sandbox: true }), `${publicConfig.demoUrl}/comparar/t%20k`);
  assert.equal(comparisonPortalUrl("tk"), `${publicConfig.clientUrl}/comparar/tk`);
  assert.equal(portalOrigin({ sandbox: true }), publicConfig.demoUrl);
  const text = `Hola ${publicConfig.clientUrl}/p/A y ${publicConfig.clientUrl}/firma/B`;
  assert.equal(rebasePortalLinks(text, true), `Hola ${publicConfig.demoUrl}/p/A y ${publicConfig.demoUrl}/firma/B`);
  assert.equal(rebasePortalLinks(text, false), text);
  // En el servidor el aviso del shell no hace nada (sería estado compartido entre pedidos).
  setPortalSandbox(true);
  assert.equal(portalBudgetUrl("ABCD"), `${publicConfig.clientUrl}/p/ABCD`);
});

test("links: el host del portal se decide en un solo lugar (public-config)", () => {
  const files = ["lib", "app", "components"].flatMap((dir) => walk(join(root, dir))).filter((file) => /\.(ts|tsx)$/.test(file));
  const usesClientUrl = files.filter((file) => /\bclientUrl\b/.test(src(relative(root, file)))).map((file) => relative(root, file).split("\\").join("/")).sort();
  // Solo comparan hosts o los listan (métricas, layout); ninguno arma un link del portal.
  assert.deepEqual(usesClientUrl, [
    "app/(superadmin)/superadmin/trafico/page.tsx",
    "app/layout.tsx",
    "lib/platform/trafico-core.ts",
    "lib/public-config.ts",
    "lib/server/web-metrics.ts",
  ]);
  const manual = files.filter((file) => /["'`]\/(p|firma|comparar)\/["'`]?\$\{/.test(src(relative(root, file))) && /clientes?\./.test(src(relative(root, file))));
  assert.deepEqual(manual, [], "ningún link del portal armado a mano");
  // Los lugares donde el panel y el servidor arman links pasan por las funciones únicas.
  for (const path of ["lib/server/mail/budget.ts", "lib/server/reminders.ts", "lib/server/notifications.ts", "lib/server/signature/admin.ts", "components/admin/modules/BudgetComparisons.tsx"]) {
    assert.match(src(path), /portalBudgetUrl|signaturePortalUrl|comparisonPortalUrl|rebasePortalLinks/, path);
  }
  assert.match(src("app/api/admin/budgets/send/route.ts"), /sandbox: auth\.context\.sandbox/);
  assert.match(src("lib/server/mail/send.ts"), /rebasePortalLinks\(input\.html, true\)/, "la vista previa simulada también usa el host demo");
});

test("correo simulado: la ruta de envío y la de recordatorios devuelven la vista previa y el panel la muestra", () => {
  const send = src("app/api/admin/budgets/send/route.ts");
  assert.match(send, /result\.simulated/);
  assert.match(send, /preview: attempt\.preview \?\? null/);
  const reminders = src("app/api/admin/reminders/route.ts");
  assert.match(reminders, /outcome\.simulated/);
  assert.match(reminders, /!emailConfigured\(\) && !auth\.context\.sandbox/, "en la demo falte o no el proveedor, el recordatorio se simula");
  const mail = read("components/admin/AdminSimulatedMail.tsx");
  assert.ok(mail.includes("AdminSimulatedMailDialog") && mail.includes("SIMULATED_MAIL_NOTICE"));
  assert.equal(read("lib/mail-preview.ts").includes('"Demo: el correo se simuló, así se vería"'), true);
  for (const path of ["components/admin/modules/PresupuestosModule.tsx", "components/admin/modules/FinanzasModule.tsx"]) {
    const code = src(path);
    assert.ok(code.includes("AdminSimulatedMailDialog") && code.includes("SIMULATED_MAIL_NOTICE"), path);
    assert.ok(/\.simulated/.test(code), `${path} distingue lo simulado de lo enviado`);
  }
  // El historial de recordatorios no pasa por "failed" por una salida simulada.
  assert.match(src("lib/server/resend.ts"), /if \(result\.simulated\) return \{ simulated: true, preview: result\.preview \}/);
});

test("WhatsApp en la demo: 'Así se vería el mensaje' con el texto, sin abrir wa.me", () => {
  const ui = src("components/admin/AdminUI.tsx");
  assert.ok(ui.includes("AdminSimulatedMessageDialog") && ui.includes("SIMULATED_WHATSAPP_NOTICE"));
  assert.equal(read("lib/mail-preview.ts").includes('"Así se vería el mensaje"'), true);
  const dialog = src("components/admin/AdminMessageTemplateDialog.tsx");
  assert.ok(dialog.includes("SIMULATED_WHATSAPP_NOTICE") && dialog.includes("Simular envío"));
  assert.ok(src("components/admin/AdminShell.tsx").includes("AdminSimulatedMessageDialog"));
  // Los accesos de plantilla se dibujan aunque `whatsappHref` sea null en la sandbox.
  assert.ok(src("components/admin/modules/FinanzasModule.tsx").includes("whatsappReachable(payment.client.phone)"));
  assert.ok(src("components/admin/modules/EventosModule.tsx").includes("whatsappReachable(event.client.phone)"));
  assert.ok(!/wa\.me/.test(ui + dialog), "ninguna pantalla arma wa.me a mano");
});

test("portal de la demo: franja 'DEMO: no es un presupuesto real' solo en el host demo y noindex", () => {
  const layout = src("app/(portal)/layout.tsx");
  assert.ok(layout.includes("DEMO: no es un presupuesto real"));
  assert.ok(layout.includes("await onDemoHost()"));
  assert.match(layout, /demoHost \? \(/);
  assert.match(layout, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});

test("OTP: solo una sandbox con el correo simulado lo muestra; la empresa real no", () => {
  assert.equal(demoOtpToExpose({ sandbox: true, mailSimulated: true, code: "123456" }), "123456");
  assert.equal(demoOtpToExpose({ sandbox: false, mailSimulated: true, code: "123456" }), undefined, "destino *.demo de una empresa real");
  assert.equal(demoOtpToExpose({ sandbox: true, mailSimulated: false, code: "123456" }), undefined);
  assert.equal(demoOtpToExpose({ sandbox: true, mailSimulated: undefined, code: "123456" }), undefined);
  assert.equal(demoOtpToExpose({ sandbox: false, mailSimulated: undefined, code: "123456" }), undefined);
  const route = src("app/api/portal/firma/[codigo]/otp/route.ts");
  assert.match(route, /demoOtp !== undefined \? \{ demoOtp \}/);
  const view = src("app/(portal)/_components/SignaturePortalView.tsx");
  assert.ok(view.includes("data.demoOtp") && view.includes("portal-demo-otp"));
  // El único lugar que decide es demoOtpToExpose, dentro de sendSignatureOtp.
  assert.equal((src("lib/server/signature/portal.ts").match(/demoOtpToExpose\(/g) ?? []).length, 2, "definición + una sola llamada");
});

test("mayorista y tienda web: 'No disponible en la demo' en la sandbox", () => {
  assert.equal(read("lib/mail-preview.ts").includes('"No disponible en la demo"'), true);
  const access = src("components/admin/modules/ClientCatalogAccess.tsx");
  assert.match(access, /if \(sandbox\) \{[\s\S]*SANDBOX_UNAVAILABLE/);
  assert.match(access, /<ClientCatalogAccessLive/, "en la sandbox ni siquiera consulta el acceso mayorista");
  const ajustes = src("components/admin/modules/AjustesModule.tsx");
  assert.match(ajustes, /sandbox\s*\?\s*\(/);
  assert.ok(ajustes.includes("SANDBOX_UNAVAILABLE"));
});

test("QA E3: el recordatorio simulado se audita como simulado y un error de sesión apaga el modo demo de los links", async () => {
  const { readFileSync } = await import("node:fs");
  const reminders = readFileSync("lib/server/reminders.ts", "utf8");
  assert.match(reminders, /sent\.simulated\s*\?\s*`Simuló el recordatorio de pago/);
  assert.match(reminders, /fields: \{ \.\.\.detail\.fields, simulado: true \}/);
  const shell = readFileSync("components/admin/AdminShell.tsx", "utf8");
  assert.match(shell, /setWhatsappSandbox\(false\);\s*setPortalSandbox\(false\);\s*setSession\(\(current\) => \(\{ \.\.\.current, loading: false, error: result\.error \}\)\)/);
});
