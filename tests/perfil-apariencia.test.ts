import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COVER_ASPECT,
  COVER_MAX_BYTES,
  COVER_SPEC,
  FONTS,
  TEMPLATES,
  adjustBrandColor,
  appearanceView,
  checkCoverFile,
  googleFontHref,
  mutedOn,
  parseAppearance,
  parseBackground,
  readAppearance,
  sniffImageMime,
} from "../lib/appearance";
import { ACCESS_REQUEST_ACK, CATALOG_ACCESS_MODES, isCatalogAccessMode } from "../lib/catalog-access-mode";
import { googleMapsUrlValid, normalizeGoogleMapsUrl, parseTimeRanges, timeOfDayMinutes } from "../lib/field-rules";
import {
  acceptedPaymentMethods,
  emptyProfile,
  hoursSummary,
  locationLine,
  normalizeInstagram,
  normalizeWebsite,
  parseOrgProfile,
  profileHasData,
  readOrgProfile,
} from "../lib/org-profile";
import { contrastRatio, storefrontTheme } from "../lib/storefront-theme";
import { buildPortalCompany, portalBrandVars } from "../lib/portal-company";
import { renderMail } from "../lib/server/mail/template";
import { MODIFY_ACTIONS, parseModifyInput, parseRejectReason } from "../lib/server/quote-request-response";
import { MANUAL_STATUSES, RESPONDABLE_STATUSES, CONVERTIBLE_STATUSES, quoteItemActive } from "../lib/catalog-public";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

// ── Link de Google Maps ─────────────────────────────────────────────────────

test("Maps: solo https://google.com/maps… y https://maps.app.goo.gl/…; todo lo demás se rechaza", () => {
  for (const ok of [
    "https://www.google.com/maps/place/La+Vajilla/@-25.28,-57.63,17z",
    "https://google.com/maps?q=-25.28,-57.63",
    "https://maps.app.goo.gl/AbCdEf123",
    "https://maps.google.com/?q=Asuncion",
  ]) assert.ok(googleMapsUrlValid(ok), ok);
  for (const bad of [
    "http://www.google.com/maps/place/x",
    "https://www.google.com/search?q=maps",
    "https://google.com.evil.com/maps/x",
    "https://evil.com/www.google.com/maps",
    "https://maps.app.goo.gl",
    "https://maps.app.goo.gl/",
    "javascript:alert(1)",
    "https://user:pass@www.google.com/maps/x",
    "https://www.google.com:8443/maps/x",
    "https://goo.gl/maps/abc",
    "www.google.com/maps",
    "https://www.google.com/maps/x y",
    "",
    "   ",
  ]) assert.equal(googleMapsUrlValid(bad), false, bad);
  assert.equal(googleMapsUrlValid(null), false);
  assert.equal(googleMapsUrlValid(42), false);
  assert.equal(googleMapsUrlValid(`https://maps.app.goo.gl/${"a".repeat(600)}`), false, "largo máximo");
  assert.equal(normalizeGoogleMapsUrl("  https://maps.app.goo.gl/Xy12  "), "https://maps.app.goo.gl/Xy12");
});

// ── Horarios ─────────────────────────────────────────────────────────────────

test("horarios: HH:MM de 24 h, fin posterior, sin superposición, hasta 4 franjas y ordenadas", () => {
  assert.equal(timeOfDayMinutes("08:30"), 510);
  assert.equal(timeOfDayMinutes("24:00"), null);
  assert.equal(timeOfDayMinutes("8:30"), null);
  assert.equal(timeOfDayMinutes("12:60"), null);
  assert.deepEqual(parseTimeRanges([{ from: "14:00", to: "18:00" }, { from: "08:00", to: "12:00" }]), { ok: true, ranges: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] });
  assert.deepEqual(parseTimeRanges(undefined), { ok: true, ranges: [] });
  assert.equal(parseTimeRanges([{ from: "10:00", to: "09:00" }]).ok, false, "fin anterior al inicio");
  assert.equal(parseTimeRanges([{ from: "10:00", to: "10:00" }]).ok, false, "franja vacía");
  assert.equal(parseTimeRanges([{ from: "08:00", to: "12:00" }, { from: "11:00", to: "13:00" }]).ok, false, "superpuestas");
  assert.equal(parseTimeRanges([{ from: "08:00", to: "10:00" }, { from: "10:00", to: "12:00" }]).ok, true, "contiguas sí");
  assert.equal(parseTimeRanges(Array.from({ length: 5 }, (_, i) => ({ from: `0${i}:00`, to: `0${i}:30` }))).ok, false, "más de 4 franjas");
  assert.equal(parseTimeRanges("lunes").ok, false);
  assert.equal(parseTimeRanges([{ from: "08:00" }]).ok, false);
});

test("perfil: normaliza teléfonos, correo, Instagram y web; valida Maps y horarios por día; lo vacío queda vacío", () => {
  const parsed = parseOrgProfile({
    contact: { phone: "981 123 456", phone2: "", whatsapp: "+595 981 654 321", instagram: "https://www.instagram.com/lavajilla.py/", email: "  Info@LaVajilla.COM.PY ", website: "lavajilla.com.py" },
    location: { address: "  Av. España  1234 ", city: "Asunción", neighborhood: "", mapsUrl: "https://maps.app.goo.gl/AbCd" },
    hours: { lun: { closed: false, ranges: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] }, dom: { closed: true, ranges: [{ from: "08:00", to: "09:00" }] } },
    handover: { delivery: [{ from: "07:00", to: "10:00" }] },
    paymentMethods: { transfer: true, cash: true, other: true },
    paymentMethodsOther: "cheque",
    conditions: "  Seña del 50 %.  ",
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const profile = parsed.value;
  assert.equal(profile.contact.phone, "+595 981123456");
  assert.equal(profile.contact.phone2, null);
  assert.equal(profile.contact.instagram, "lavajilla.py");
  assert.equal(profile.contact.email, "info@lavajilla.com.py");
  assert.equal(profile.contact.website, "https://lavajilla.com.py");
  assert.equal(profile.location.address, "Av. España 1234");
  assert.equal(profile.location.neighborhood, null);
  assert.equal(profile.hours.dom.closed, true);
  assert.deepEqual(profile.hours.dom.ranges, [], "un día cerrado no guarda franjas");
  assert.equal(profile.hours.mar.ranges.length, 0);
  assert.deepEqual(profile.handover.delivery, [{ from: "07:00", to: "10:00" }]);
  assert.deepEqual(acceptedPaymentMethods(profile), ["Transferencia", "Efectivo", "cheque"]);
  assert.equal(profile.conditions, "Seña del 50 %.");
  assert.equal(locationLine(profile), "Av. España 1234, Asunción");
  assert.equal(profileHasData(profile), true);
  assert.equal(profileHasData(emptyProfile()), false);
  // Idempotente: lo guardado se vuelve a leer igual.
  assert.deepEqual(readOrgProfile(JSON.parse(JSON.stringify(profile))), profile);
});

test("perfil: rechaza datos inválidos con un mensaje en castellano y nunca lanza al leer filas rotas", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ location: { mapsUrl: "https://evil.com/maps" } }, /Google Maps/],
    [{ contact: { phone: "12" } }, /teléfono/i],
    [{ contact: { email: "no-es-correo" } }, /correo/i],
    [{ contact: { instagram: "a b c" } }, /Instagram/],
    [{ contact: { website: "javascript:alert(1)" } }, /web/i],
    [{ hours: { lun: { closed: false, ranges: [{ from: "18:00", to: "08:00" }] } } }, /Lunes/],
    [{ hours: { mar: { ranges: [{ from: "08:00", to: "12:00" }, { from: "11:00", to: "13:00" }] } } }, /Martes/],
    [{ handover: { return: [{ from: "25:00", to: "26:00" }] } }, /Devolución/],
    [{ paymentMethods: { cash: "si" } }, /Efectivo/],
    [{ conditions: "x".repeat(601) }, /600/],
  ];
  for (const [input, message] of cases) {
    const result = parseOrgProfile(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.match(result.error, message);
  }
  assert.deepEqual(readOrgProfile("basura"), emptyProfile());
  assert.deepEqual(readOrgProfile({ location: { mapsUrl: "https://evil.com" } }), emptyProfile());
  assert.equal(normalizeInstagram("@la.vajilla"), "la.vajilla");
  assert.equal(normalizeInstagram("a/b"), null);
  assert.equal(normalizeWebsite("ftp://x.com"), null);
});

test("horario de atención: agrupa días contiguos iguales y respeta «cerrado»", () => {
  const profile = emptyProfile();
  for (const day of ["lun", "mar", "mie", "jue", "vie"] as const) profile.hours[day] = { closed: false, ranges: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] };
  profile.hours.sab = { closed: false, ranges: [{ from: "08:00", to: "12:00" }] };
  profile.hours.dom = { closed: true, ranges: [] };
  assert.deepEqual(hoursSummary(profile.hours), [
    { days: "Lunes a viernes", text: "08:00 a 12:00 · 14:00 a 18:00" },
    { days: "Sábado", text: "08:00 a 12:00" },
    { days: "Domingo", text: "Cerrado" },
  ]);
  assert.deepEqual(hoursSummary(emptyProfile().hours), [], "sin horario cargado no se inventa nada");
});

// ── Contraste y color de marca ───────────────────────────────────────────────

test("color de marca: pasa si ya cumple AA; si no, se oscurece lo mínimo, llega a 4,5:1 y avisa", () => {
  const dark = adjustBrandColor("#0b5cd5");
  assert.ok(dark.ok && dark.result);
  if (dark.ok && dark.result) {
    assert.equal(dark.result.adjusted, false);
    assert.equal(dark.result.color, "#0b5cd5");
    assert.equal(dark.result.notice, null);
  }
  const light = adjustBrandColor("#ffd400");
  assert.ok(light.ok && light.result);
  if (light.ok && light.result) {
    assert.equal(light.result.adjusted, true);
    assert.ok(contrastRatio(light.result.color, "#ffffff") >= 4.5, `contraste ${contrastRatio(light.result.color, "#ffffff")}`);
    assert.ok(light.result.ratio >= 4.5);
    assert.match(light.result.notice ?? "", /Ajustamos #ffd400 a #[0-9a-f]{6}/);
    assert.match(light.result.notice ?? "", /4,5:1/);
    // Mínimo necesario: un paso antes no alcanzaba.
    assert.notEqual(light.result.color, "#000000");
  }
  // Blanco puro y colores muy claros también llegan.
  for (const hex of ["#ffffff", "#f5f5f5", "#a0e7ff", "#ffeb3b"]) {
    const result = adjustBrandColor(hex);
    assert.ok(result.ok && result.result && contrastRatio(result.result.color, "#ffffff") >= 4.5, hex);
  }
  assert.deepEqual(adjustBrandColor(""), { ok: true, result: null });
  assert.deepEqual(adjustBrandColor(null), { ok: true, result: null });
  assert.equal(adjustBrandColor("rojo").ok, false);
  assert.equal(adjustBrandColor("#12").ok, false);
});

test("color de marca con fondo propio: también se verifica contra ese fondo", () => {
  const beige = "#f6f1e8";
  const result = adjustBrandColor("#a67c52", { background: beige });
  assert.ok(result.ok && result.result);
  if (result.ok && result.result) {
    assert.ok(contrastRatio(result.result.color, "#ffffff") >= 4.5);
    assert.ok(contrastRatio(result.result.color, beige) >= 4.5);
  }
  // El tema deriva el tono oscuro aclarando hasta AA sobre la superficie oscura.
  const theme = storefrontTheme("#0b5cd5");
  assert.equal(theme.branded, true);
  assert.ok(contrastRatio(theme.dark.accent, "#171b20") >= 4.5);
});

test("fondo propio: solo claro (contraste ≥ 7:1 con el texto) y el texto secundario mantiene AA", () => {
  assert.deepEqual(parseBackground(""), { ok: true, background: null });
  assert.deepEqual(parseBackground("#F6F1E8"), { ok: true, background: "#f6f1e8" });
  for (const bad of ["#0e1114", "#444444", "azul", "#777"]) assert.equal(parseBackground(bad).ok, false, bad);
  for (const bg of ["#f6f1e8", "#ffffff", "#e8f0fe"]) assert.ok(contrastRatio(mutedOn(bg), bg) >= 4.5, bg);
});

// ── Apariencia ───────────────────────────────────────────────────────────────

test("apariencia: plantilla y tipografía de listas cerradas; lo demás se rechaza", () => {
  assert.deepEqual([...TEMPLATES], ["clasica", "minimalista", "elegante", "oscura", "editorial"]);
  const ok = parseAppearance({ template: "elegante", font: "playfair-display", background: "#f6f1e8" });
  assert.deepEqual(ok, { ok: true, appearance: { template: "elegante", font: "playfair-display", background: "#f6f1e8", script: false } });
  assert.equal(parseAppearance({ template: "neon" }).ok, false);
  assert.equal(parseAppearance({ font: "Comic Sans" }).ok, false);
  assert.equal(parseAppearance({ template: "<style>x</style>" }).ok, false, "nada de CSS libre");
  assert.deepEqual(readAppearance("basura"), { template: "clasica", font: "sistema", background: null, script: false });
  // Los campos ausentes mantienen lo actual.
  assert.deepEqual(parseAppearance({ font: "inter" }, { template: "oscura", font: "sistema", background: null, script: false }), { ok: true, appearance: { template: "oscura", font: "inter", background: null, script: false } });
});

test("apariencia: solo tokens CSS (variables y data-*) y fuentes de Google desde una lista cerrada", () => {
  const view = appearanceView({ template: "elegante", font: "playfair-display", background: "#f6f1e8", script: false });
  assert.equal(view.attrs["data-cp-template"], "elegante");
  assert.equal(view.attrs["data-cp-bg"], "custom");
  assert.ok(Object.keys(view.vars).every((key) => key.startsWith("--cp-")), "solo variables --cp-*");
  assert.match(view.fontHref ?? "", /^https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display/);
  assert.equal(googleFontHref("sistema"), null);
  assert.equal(googleFontHref("no-existe"), null);
  for (const font of FONTS) if (font.google) assert.match(googleFontHref(font.id)!, /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+:;@=.]+&display=swap$/);
  // La plantilla oscura ignora el fondo claro.
  assert.equal(appearanceView({ template: "oscura", font: "sistema", background: "#f6f1e8", script: false }).attrs["data-cp-bg"], "default");
  // Las plantillas existen en la hoja de estilos (o son la base).
  const css = read("app/globals.css");
  for (const id of ["minimalista", "elegante", "oscura", "editorial"]) assert.ok(css.includes(`.cp-theme[data-cp-template="${id}"]`), id);
});

// ── Portada ──────────────────────────────────────────────────────────────────

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);

test("portada: dos archivos con medida recomendada, JPG/PNG/WebP por bytes mágicos y 2 MB máximo", () => {
  assert.deepEqual([COVER_SPEC.desktop.width, COVER_SPEC.desktop.height], [1920, 600]);
  assert.deepEqual([COVER_SPEC.mobile.width, COVER_SPEC.mobile.height], [1080, 1350]);
  assert.equal(COVER_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(COVER_ASPECT.desktop, "1920 / 600");
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(JPG), "image/jpeg");
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(Buffer.from("<?php system($_GET[0]); ?>")), null);
  assert.equal(sniffImageMime(Buffer.from("GIF89a....")), null, "GIF no se acepta");
  assert.equal(sniffImageMime(Buffer.from("RIFF\0\0\0\0WAVE")), null, "RIFF que no es WebP");
  assert.deepEqual(checkCoverFile(PNG), { ok: true, mime: "image/png" });
  assert.equal(checkCoverFile(new Uint8Array(0)).ok, false);
  assert.equal(checkCoverFile(Buffer.from("MZ\x90\x00 programa renombrado a .jpg")).ok, false);
  const big = new Uint8Array(COVER_MAX_BYTES + 1);
  big.set(JPG);
  const tooBig = checkCoverFile(big);
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.match(tooBig.error, /2 MB/);
  const exact = new Uint8Array(COVER_MAX_BYTES);
  exact.set(JPG);
  assert.equal(checkCoverFile(exact).ok, true, "justo 2 MB entra");
});

test("portada: sharp redimensiona al ancho recomendado, comprime a WebP y rechaza lo que no es imagen real", async () => {
  const { default: sharp } = await import("sharp");
  const { prepareCover } = await import("../lib/server/covers");
  const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  const ok = await prepareCover(new Uint8Array(wide), "desktop");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.mime, "image/webp");
    assert.equal(ok.width, 1920, "no pasa del ancho recomendado");
    assert.ok(ok.data.byteLength <= COVER_MAX_BYTES);
    assert.equal(sniffImageMime(ok.data), "image/webp");
  }
  const small = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  const kept = await prepareCover(new Uint8Array(small), "mobile");
  assert.ok(kept.ok && kept.width === 800, "no agranda");
  const tiny = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
  const rejected = await prepareCover(new Uint8Array(tiny), "desktop");
  assert.equal(rejected.ok, false);
  const fake = await prepareCover(new Uint8Array(Buffer.from("esto es un script renombrado a portada.jpg")), "desktop");
  assert.deepEqual(fake.ok, false);
  if (!fake.ok) assert.equal(fake.status, 400);
  // Cabecera de PNG válida pero cuerpo roto: sharp falla y no se guarda nada.
  const broken = await prepareCover(new Uint8Array([...PNG, ...Buffer.from("no es un png")]), "desktop");
  assert.equal(broken.ok, false);
});

// ── Acceso, pedidos y correos ────────────────────────────────────────────────

test("acceso al catálogo: tres modos cerrados y una respuesta que no revela si el correo existe", () => {
  assert.deepEqual([...CATALOG_ACCESS_MODES], ["OPEN", "REQUEST", "PRIVATE"]);
  assert.equal(isCatalogAccessMode("REQUEST"), true);
  assert.equal(isCatalogAccessMode("request"), false);
  assert.equal(isCatalogAccessMode("CLOSED"), false);
  assert.doesNotMatch(ACCESS_REQUEST_ACK, /ya (existe|pidió|solicit)|duplicad/i);
  const route = read("app/api/catalog/[orgSlug]/access-request/route.ts");
  assert.match(route, /rateLimit\(/);
  assert.match(route, /isHoneypotTriggered/);
  assert.match(route, /status: 202/);
  const lib = read("lib/server/catalog-access-requests.ts");
  assert.match(lib, /return \{ ack: ACCESS_REQUEST_ACK, created: false \}/, "el duplicado devuelve el mismo acuse");
});

test("pedido: estados de la propuesta y reglas de conversión", () => {
  assert.ok(RESPONDABLE_STATUSES.includes("PROPOSED") && RESPONDABLE_STATUSES.includes("APPROVED"));
  assert.ok(CONVERTIBLE_STATUSES.includes("APPROVED") && !CONVERTIBLE_STATUSES.includes("PROPOSED"), "una propuesta pendiente no se acepta antes de que el cliente la apruebe");
  assert.ok(!MANUAL_STATUSES.includes("PROPOSED" as never) && !MANUAL_STATUSES.includes("APPROVED" as never) && !MANUAL_STATUSES.includes("CONVERTED" as never));
  assert.equal(quoteItemActive("REMOVED"), false);
  assert.equal(quoteItemActive("UNAVAILABLE"), false);
  for (const state of ["KEEP", "CHANGED", "SUBSTITUTED", undefined, null]) assert.equal(quoteItemActive(state), true, String(state));
});

test("rechazo y modificación: validan el motivo y las líneas antes de tocar la base", () => {
  assert.equal(parseRejectReason("  ").ok, false);
  assert.equal(parseRejectReason("no").ok, false);
  assert.equal(parseRejectReason("x".repeat(501)).ok, false);
  assert.deepEqual(parseRejectReason("  Sin   stock   esa fecha "), { ok: true, reason: "Sin stock esa fecha" });
  assert.deepEqual([...MODIFY_ACTIONS], ["keep", "quantity", "remove", "unavailable", "substitute"]);
  const ok = parseModifyInput({ note: " Te ofrecemos  esto ", lines: [{ itemId: "a", action: "quantity", quantity: 3 }, { itemId: "b", action: "remove" }, { itemId: "c", action: "substitute", quantity: 2, substituteInventoryId: "z" }, { itemId: "d", action: "unavailable" }] });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.note, "Te ofrecemos esto");
  for (const bad of [
    {},
    { lines: [] },
    { lines: [{ itemId: "a", action: "borrar" }] },
    { lines: [{ itemId: "a", action: "quantity" }] },
    { lines: [{ itemId: "a", action: "quantity", quantity: 0 }] },
    { lines: [{ itemId: "a", action: "quantity", quantity: 1.5 }] },
    { lines: [{ itemId: "a", action: "quantity", quantity: 100 }] },
    { lines: [{ itemId: "a", action: "substitute", quantity: 1 }] },
    { lines: [{ itemId: "a", action: "keep" }, { itemId: "a", action: "remove" }] },
    { lines: [{ action: "keep" }] },
  ]) assert.equal(parseModifyInput(bad).ok, false, JSON.stringify(bad));
  assert.equal(parseModifyInput({ lines: [{ itemId: "a", action: "keep" }], note: "x".repeat(501) }).ok, false);
});

test("correos de la empresa: solo color y logo; el botón usa su color con texto legible y sin tocar el resto", () => {
  const base = { title: "Hola", intro: "Texto", cta: { label: "Abrir", url: "https://x.test" } };
  const plain = renderMail(base);
  assert.match(plain, /class="lb-btn"/);
  const branded = renderMail({ ...base, brand: { color: "#0b5cd5", logoUrl: "https://ledbox.online/api/catalog/lv/logo/light", name: "La Vajilla" } });
  assert.match(branded, /class="lb-btn-brand"[^>]*background:#0b5cd5/);
  assert.doesNotMatch(branded, /class="lb-btn"/);
  assert.match(branded, /<img src="https:\/\/ledbox\.online\/api\/catalog\/lv\/logo\/light"/);
  assert.match(branded, /color:#ffffff/, "texto blanco sobre azul oscuro");
  // Un color de marca inválido no rompe el correo: cae al acento de EventOS.
  assert.match(renderMail({ ...base, brand: { color: "rojo" } }), /class="lb-btn"/);
  // El logo viene escapado.
  assert.doesNotMatch(renderMail({ ...base, brand: { logoUrl: 'https://x.test/"><script>' } }), /<script>/);
  // Sin logo público, el encabezado lleva el isotipo de EventOS y solo el nombre de la empresa (nunca «LedBox»).
  const sinLogo = renderMail({ ...base, brand: { color: "#0b5cd5", name: "La Vajilla" } });
  assert.match(sinLogo, /alt="EventOS"/);
  assert.match(sinLogo, />La Vajilla</);
  assert.doesNotMatch(sinLogo, /alt="La Vajilla"/);
  assert.doesNotMatch(sinLogo, /alt="LedBox/);
});

test("portal: el color de la empresa llega en los dos tonos y la tipografía solo si es de Google", () => {
  const company = buildPortalCompany({ name: "La Vajilla", profile: { contact: { phone: "981 123 456" } }, appearance: { font: "poppins" }, accent: "#0b5cd5" });
  assert.equal(company.profile?.contact.phone, "+595 981123456");
  assert.ok(company.brand);
  assert.ok(contrastRatio(company.brand!.dark.accent, "#171b20") >= 4.5);
  const vars = portalBrandVars(company);
  assert.ok(vars["--pb-l"] && vars["--pb-d"] && vars["--pb-font"]);
  assert.deepEqual(portalBrandVars(buildPortalCompany({ name: "x", profile: null, appearance: null, accent: null })), {});
  assert.equal(buildPortalCompany({ name: "x", profile: null, appearance: null, accent: null }).profile, null, "sin perfil cargado no se dibuja el bloque");
});

test("fuente: las rutas del panel exigen org.manage / clients.write y los endpoints públicos llevan sus defensas", () => {
  for (const path of ["app/api/admin/organization/profile/route.ts", "app/api/admin/organization/appearance/route.ts", "app/api/admin/organization/appearance/covers/[kind]/route.ts"]) {
    assert.match(read(path), /requireAdminContext\("org\.manage"\)/, path);
  }
  for (const path of ["app/api/admin/quote-requests/[id]/reject/route.ts", "app/api/admin/quote-requests/[id]/modify/route.ts", "app/api/admin/catalog-access-requests/[id]/route.ts"]) {
    assert.match(read(path), /requireAdminContext\("clients\.write"\)/, path);
  }
  const respond = read("app/api/pedido/[token]/route.ts");
  assert.match(respond, /rateLimit\(/);
  const convert = read("lib/server/catalog-convert.ts");
  assert.match(convert, /quoteItemActive\(item\.state\)/, "convertir ignora las líneas quitadas");
  assert.match(read("lib/server/quote-request-response.ts"), /findSubstitutes\(/, "los reemplazos salen de findSubstitutes");
  assert.match(read("lib/server/quote-request-response.ts"), /stockShortages\(/, "se verifica el stock real");
  assert.match(read("lib/server/catalog-preorder-http.ts"), /catalogAccessMode !== "OPEN"/, "una tienda restringida no recibe pedidos sin link");
  // Las plantillas nunca meten CSS libre ni HTML de la empresa.
  assert.doesNotMatch(read("components/catalog-public/StoreChrome.tsx"), /dangerouslySetInnerHTML/);
  assert.doesNotMatch(read("lib/appearance.ts"), /dangerouslySetInnerHTML/);
});
