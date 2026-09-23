import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountError,
  amountInput,
  amountValid,
  CITY_OPTIONS,
  cityDepartment,
  digitsOnly,
  emailError,
  emailValid,
  FIELD_LIMITS,
  FIELD_MESSAGES,
  formatPercent,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  normalizeSerial,
  parseAmount,
  parsePercent,
  parsePhone,
  percentError,
  percentInput,
  percentValid,
  personNameError,
  personNameValid,
  phoneError,
  phoneValid,
  requiredError,
  serialError,
  serialValid,
} from "../lib/field-rules";
import {
  detectIdentityImageMime,
  detectPaymentProofMime,
  IDENTITY_IMAGE_MAX_BYTES,
  identityImageExtension,
  isLogoVariant,
  organizationLogoUrl,
  adminAvatarUrl,
} from "../lib/admin-types";

test("digitsOnly limpia todo lo que no sea dígito", () => {
  assert.equal(digitsOnly("+595 981-000.000"), "595981000000");
  assert.equal(digitsOnly("abc"), "");
});

test("monto PYG: tolera pegado con símbolo y separadores y entrega entero limpio", () => {
  assert.equal(amountInput("Gs 1.500.000"), "1500000");
  assert.equal(amountInput(" 2 000 000 "), "2000000");
  assert.equal(amountInput("007"), "7");
  assert.equal(parseAmount("1.500.000"), 1500000);
  assert.equal(parseAmount(""), null);
  assert.equal(amountValid("1.500.000"), true);
  assert.equal(amountValid("10.000.000.001", FIELD_LIMITS.amountGeneral), false);
  assert.equal(amountValid("99.000.000.000", FIELD_LIMITS.amountSales), true);
  assert.equal(amountError("1.500.000"), null);
  assert.equal(amountError("no"), FIELD_MESSAGES.amount);
  assert.equal(amountError("20.000.000.000", FIELD_LIMITS.amountGeneral), FIELD_MESSAGES.amountLimit);
});

test("porcentaje: coma decimal, 0–100 y hasta 2 decimales", () => {
  assert.equal(percentInput("12,5"), "12.5");
  assert.equal(percentInput("12,345"), "12.34");
  assert.equal(percentInput("abc10%"), "10");
  assert.equal(percentInput("0,50"), "0.50");
  assert.equal(parsePercent("12,5"), 12.5);
  assert.equal(parsePercent("100"), 100);
  assert.equal(parsePercent("101"), null);
  assert.equal(parsePercent(""), null);
  assert.equal(percentValid("99,99"), true);
  assert.equal(percentError("120"), FIELD_MESSAGES.percent);
  assert.equal(formatPercent(12.5), "12,5");
  assert.equal(formatPercent(null), "—");
});

test("correo: se guarda en minúsculas y valida hasta 200 caracteres", () => {
  assert.equal(normalizeEmail("  Ana@LedBox.Online  "), "ana@ledbox.online");
  assert.equal(emailValid("ana@ledbox.online"), true);
  assert.equal(emailValid("ana@ledbox"), false);
  assert.equal(emailValid(`${"a".repeat(FIELD_LIMITS.email)}@ledbox.online`), false);
  assert.equal(emailError("no-es-correo"), FIELD_MESSAGES.email);
  assert.equal(emailError("ana@ledbox.online"), null);
});

test("serial: mayúsculas, sin espacios ni símbolos raros", () => {
  assert.equal(normalizeSerial("  sn-123 456  "), "SN-123456");
  assert.equal(normalizeSerial("a:b;c"), "ABC");
  assert.equal(serialValid("SN-123456"), true);
  assert.equal(serialValid("A"), false);
  assert.equal(serialError("··"), FIELD_MESSAGES.serial);
});

test("teléfono: default +595, se guarda normalizado y valida largo local", () => {
  assert.deepEqual(parsePhone("+595 981 000 000"), { countryCode: "595", national: "981000000" });
  assert.deepEqual(parsePhone("0981 000 000"), { countryCode: "595", national: "0981000000" });
  assert.equal(normalizePhone("+595 981 000 000"), "+595 981000000");
  assert.equal(normalizePhone("981-000-000"), "+595 981000000");
  assert.equal(normalizePhone("(021) 234-5678"), "+595 0212345678");
  assert.equal(normalizePhone("+54 9 11 1234 5678"), "+54 91112345678");
  assert.equal(normalizePhone(""), "");
  assert.equal(phoneValid("+595 981000000"), true);
  assert.equal(phoneValid("+595 0212345678"), true);
  assert.equal(phoneValid("+595 123"), false);
  assert.equal(phoneValid("+54 91112345678"), true);
  assert.equal(phoneError("+595 123"), FIELD_MESSAGES.phone);
  assert.equal(phoneError("+595 981000000"), null);
});

test("obligatorio: un solo mensaje", () => {
  assert.equal(requiredError(""), FIELD_MESSAGES.required);
  assert.equal(requiredError("  "), FIELD_MESSAGES.required);
  assert.equal(requiredError("ok"), null);
});

test("monto PYG: la delegación en la librería conserva los bordes del contrato", () => {
  assert.equal(parseAmount("no"), null);
  assert.equal(parseAmount("000"), 0);
  assert.equal(parseAmount("9007199254740993"), null); // fuera del entero seguro
  assert.equal(amountInput("gs 1.234"), "1234");
});

test("teléfono: la delegación conserva el prefijo 00, los compactos y los vacíos", () => {
  assert.deepEqual(parsePhone("00595 981 000 000"), { countryCode: "595", national: "981000000" });
  assert.deepEqual(parsePhone("+595981000000"), { countryCode: "595", national: "981000000" });
  assert.deepEqual(parsePhone(""), { countryCode: "595", national: "" });
  assert.equal(normalizePhone("00595 981 000 000"), "+595 981000000");
  assert.equal(normalizePhone("+595981000000"), "+595 981000000");
  assert.equal(normalizePhone("   "), "");
});

test("ciudad: catálogo compartido y departamento sin distinguir acentos", () => {
  assert.ok(CITY_OPTIONS.length > 200, "el catálogo de ciudades sale de owncoding-ui");
  assert.ok(CITY_OPTIONS.some((option) => option.ciudad === "Asunción" && option.departamento === "Asunción"));
  assert.equal(cityDepartment("Asunción"), "Asunción");
  assert.equal(cityDepartment("asuncion"), "Asunción");
  assert.equal(cityDepartment("Ciudad del Este"), "Alto Paraná");
  assert.equal(cityDepartment("Villa Libre"), null);
  assert.equal(cityDepartment(""), null);
  assert.equal(cityDepartment(null), null);
});

test("nombre de persona: sin espacios de más y con el tope del panel", () => {
  assert.equal(normalizePersonName("  Ana   María  "), "Ana María");
  assert.equal(normalizePersonName(null), "");
  assert.equal(personNameValid("Ana"), true);
  assert.equal(personNameValid(" A "), false);
  assert.equal(personNameValid("a".repeat(FIELD_LIMITS.name)), true);
  assert.equal(personNameValid("a".repeat(FIELD_LIMITS.name + 1)), false);
  assert.equal(personNameError(""), FIELD_MESSAGES.name);
  assert.equal(personNameError("Ana Martínez"), null);
});

test("imagen de identidad: JPG, PNG y WebP reales; PDF y archivos falsos no", () => {
  const ascii = (text: string) => new Uint8Array([...text].map((character) => character.charCodeAt(0)));
  const webp = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);
  assert.equal(detectIdentityImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectIdentityImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectIdentityImageMime(webp), "image/webp");
  // El comprobante sí acepta PDF; la imagen de identidad no.
  assert.equal(detectPaymentProofMime(ascii("%PDF-")), "application/pdf");
  assert.equal(detectIdentityImageMime(ascii("%PDF-")), null);
  assert.equal(detectIdentityImageMime(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null);
  assert.equal(identityImageExtension("image/png"), "png");
  assert.equal(identityImageExtension("image/webp"), "webp");
  assert.equal(identityImageExtension("image/jpeg"), "jpg");
  assert.equal(IDENTITY_IMAGE_MAX_BYTES, 1024 * 1024);
});

test("URLs de identidad: avatar y logo con la versión que corta la caché", () => {
  assert.equal(adminAvatarUrl("u-1"), "/api/admin/users/avatars/u-1");
  assert.equal(
    adminAvatarUrl("u-1", "2026-09-21T10:00:00.000Z"),
    "/api/admin/users/avatars/u-1?v=2026-09-21T10%3A00%3A00.000Z",
  );
  assert.equal(organizationLogoUrl("light"), "/api/admin/organization/branding/logos/light");
  assert.equal(isLogoVariant("light"), true);
  assert.equal(isLogoVariant("dark"), true);
  assert.equal(isLogoVariant("claro"), false);
});
