import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  amountError,
  amountExceeds,
  amountInput,
  amountValid,
  caretAfterDigits,
  CITY_OPTIONS,
  cityDepartment,
  digitsOnly,
  emailError,
  emailValid,
  FIELD_LIMITS,
  FIELD_MESSAGES,
  formatPercent,
  INVENTORY_PRICE_DAYS_MAX,
  INVENTORY_PRICE_LIMIT,
  inventoryImageError,
  inventoryImageValid,
  inventoryPriceDaysValue,
  inventoryPriceValue,
  inventoryPriceWarning,
  inventorySkuError,
  inventorySkuValid,
  readInventoryPriceValues,
  moneyInputDisplay,
  moneyInputMaxLength,
  normalizeEmail,
  normalizeInventoryImage,
  normalizeInventorySku,
  normalizePersonName,
  normalizePhone,
  normalizeSerial,
  rucInput,
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
  PIN_MAX_DIGITS,
  PIN_MIN_DIGITS,
  PIN_SETTLE_MS,
  pinEntryComplete,
  pinInput,
  pinValid,
  requiredError,
  rucDocument,
  rucValid,
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
  assert.equal(percentInput("12,5"), "12,5");
  assert.equal(percentInput("12.5"), "12,5");
  assert.equal(percentInput("12,345"), "12,34");
  assert.equal(percentInput("abc10%"), "10");
  assert.equal(percentInput("0,50"), "0,50");
  assert.equal(percentInput("150"), "150"); // se puede tipear; la regla 0–100 lo rechaza
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

test("RUC / C.I.: dígitos con un guion opcional antes del verificador", () => {
  assert.equal(rucInput("80012345-6"), "80012345-6");
  assert.equal(rucInput(" 80012345-6 "), "80012345-6");
  assert.equal(rucInput("80012345"), "80012345");
  assert.equal(rucInput("abc80012345-6"), "80012345-6");
  assert.equal(rucInput("800.12345-6"), "80012345-6");
  assert.equal(rucInput("-80012345-6"), "80012345-6");
  assert.equal(rucInput("800-12-345-6"), "800-1");
  assert.equal(rucInput("80012345-"), "80012345-"); // el guion recién tipeado se conserva
  assert.equal(rucInput(""), "");
  assert.equal(rucInput("80012345678901234567890123"), "80012345678901234567"); // tope de 20
  assert.equal(rucInput("1234567890", 5), "12345");
});

test("RUC del documento (Tanda 1 #105): extrae el RUC y no pierde otros documentos", () => {
  assert.equal(rucDocument("80012345-6"), "80012345-6");
  assert.equal(rucDocument("RUC: 80012345-6"), "80012345-6");
  assert.equal(rucDocument("RUC 8.001.234.567-8 proveedor"), "8.001.234.567-8");
  assert.equal(rucDocument("  80012345-6  "), "80012345-6");
  // Sin patrón de RUC se conserva el documento (C.I. u otro) para no perderlo.
  assert.equal(rucDocument("1.234.567"), "1.234.567");
  assert.equal(rucDocument(""), null);
  assert.equal(rucDocument("   "), null);
  assert.equal(rucDocument(null), null);
  assert.equal(rucDocument(undefined), null);
  assert.equal(rucDocument("80012345-6-extra", 8), "80012345"); // respeta el tope
  assert.equal(rucValid("80012345-6"), true);
  assert.equal(rucValid("RUC 80012345-6"), true); // el patrón se busca dentro del texto
  assert.equal(rucValid("800123456"), false); // sin dígito verificador no hay RUC
  assert.equal(rucValid(""), false);
});

test("serial: mayúsculas, sin espacios ni símbolos raros", () => {
  assert.equal(normalizeSerial("  sn-123 456  "), "SN-123456");
  assert.equal(normalizeSerial("a:b;c"), "ABC");
  assert.equal(serialValid("SN-123456"), true);
  assert.equal(serialValid("A"), false);
  assert.equal(serialError("··"), FIELD_MESSAGES.serial);
});

test("imagen de inventario: ruta interna o URL http(s), sin HTML ni espacios", () => {
  assert.equal(normalizeInventoryImage("  /assets/products/pantalla-led.png  "), "/assets/products/pantalla-led.png");
  assert.equal(inventoryImageValid("/assets/products/pantalla-led.png"), true);
  assert.equal(inventoryImageValid("https://cdn.ledbox.online/equipos/pantalla.png"), true);
  assert.equal(inventoryImageValid("http://localhost:3001/assets/x.png"), true);
  assert.equal(inventoryImageValid(""), false); // vacío no es una imagen: el campo es opcional
  assert.equal(inventoryImageValid("productos/pantalla.png"), false);
  assert.equal(inventoryImageValid("//cdn.ledbox.online/x.png"), false);
  assert.equal(inventoryImageValid("javascript:alert(1)"), false);
  assert.equal(inventoryImageValid("data:image/png;base64,AAAA"), false);
  assert.equal(inventoryImageValid("ftp://ledbox.online/x.png"), false);
  assert.equal(inventoryImageValid("/assets/<script>.png"), false);
  assert.equal(inventoryImageValid("/assets/pantalla led.png"), false);
  assert.equal(inventoryImageValid(`/assets/products/${"a".repeat(FIELD_LIMITS.image)}.png`), false);
  assert.equal(inventoryImageError(""), null);
  assert.equal(inventoryImageError("   "), null);
  assert.equal(inventoryImageError("/assets/products/totem-led.png"), null);
  assert.equal(inventoryImageError("no-es-una-imagen"), FIELD_MESSAGES.image);
});

/**
 * SKU del ítem (issue #131): opcional en el alta, corto y legible; el API
 * revalida con la misma regla y el mismo mensaje.
 */
test("SKU: opcional, legible y con el mismo mensaje en front y API", () => {
  assert.equal(normalizeInventorySku("  LED-P3-500 "), "LED-P3-500");
  assert.equal(inventorySkuValid("LED-P3-500"), true);
  assert.equal(inventorySkuValid("P·01"), true);
  assert.equal(inventorySkuValid("P3.9 500x500"), true);
  assert.equal(inventorySkuValid("2"), true, "catálogos reales usan códigos de un dígito (COD# 2)");
  assert.equal(inventorySkuValid(""), false);
  assert.equal(inventorySkuValid("a/b"), false);
  assert.equal(inventorySkuValid("<script>"), false);
  assert.equal(inventorySkuValid(`SKU-${"x".repeat(FIELD_LIMITS.sku)}`), false);
  assert.equal(inventorySkuError(""), null);
  assert.equal(inventorySkuError("   "), null);
  assert.equal(inventorySkuError("LED-P3-500"), null);
  assert.equal(inventorySkuError("<script>"), FIELD_MESSAGES.sku);
  assert.equal(FIELD_MESSAGES.sku.includes("1 a 60"), true);
});

test("precios de venta: enteros ≥ 0 dentro del tope; vacío no cambia, basura se rechaza", () => {
  assert.equal(INVENTORY_PRICE_LIMIT, 10_000_000_000);
  assert.equal(inventoryPriceValue(750_000), 750_000);
  assert.equal(inventoryPriceValue(0), 0);
  assert.equal(inventoryPriceValue("500000"), 500_000);
  assert.equal(inventoryPriceValue(INVENTORY_PRICE_LIMIT), INVENTORY_PRICE_LIMIT);
  assert.equal(inventoryPriceValue(INVENTORY_PRICE_LIMIT + 1), false);
  assert.equal(inventoryPriceValue(-1), false);
  assert.equal(inventoryPriceValue(1.5), false);
  assert.equal(inventoryPriceValue("<b>750.000</b>"), false);
  assert.equal(inventoryPriceValue("750000000000000000000"), false);
  assert.equal(inventoryPriceValue(undefined), null);
  assert.equal(inventoryPriceValue(null), null);
  assert.equal(inventoryPriceValue(""), null);
});

test("días de las reglas: entero entre 0 y el tope; vacío no cambia", () => {
  assert.equal(INVENTORY_PRICE_DAYS_MAX, 3650);
  assert.equal(inventoryPriceDaysValue(3), 3);
  assert.equal(inventoryPriceDaysValue("0"), 0);
  assert.equal(inventoryPriceDaysValue(3650), 3650);
  assert.equal(inventoryPriceDaysValue(3651), false);
  assert.equal(inventoryPriceDaysValue(2.5), false);
  assert.equal(inventoryPriceDaysValue("<i>3</i>"), false);
  assert.equal(inventoryPriceDaysValue(undefined), null);
  assert.equal(inventoryPriceDaysValue(null), null);
});

test("los siete campos de precios se validan de una vez (issues #90 y #110)", () => {
  const full = {
    listPrice: "750000",
    listFromDays: "3",
    listFromPrice: "500000",
    wholesalePrice: "600000",
    wholesaleFromDays: "5",
    wholesaleFromPrice: "450000",
    minimumPrice: "400000",
  };
  const read = readInventoryPriceValues(full);
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.deepEqual(read.values, {
      listPrice: 750_000,
      listFromDays: 3,
      listFromPrice: 500_000,
      wholesalePrice: 600_000,
      wholesaleFromDays: 5,
      wholesaleFromPrice: 450_000,
      minimumPrice: 400_000,
    });
  }
  // Vacíos = sin valor (no cambia / queda en 0); basura o tope excedido = error.
  const empty = readInventoryPriceValues({});
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.values.listFromPrice, null);
  const badPrice = readInventoryPriceValues({ ...full, listFromPrice: "<b>" });
  assert.equal(badPrice.ok, false);
  if (!badPrice.ok) assert.equal(badPrice.error, FIELD_MESSAGES.price);
  const badDays = readInventoryPriceValues({ ...full, wholesaleFromDays: "3651" });
  assert.equal(badDays.ok, false);
  if (!badDays.ok) assert.equal(badDays.error, FIELD_MESSAGES.priceDays);
});

test("aviso de precios: coherencia entre frentes y dentro de cada frente", () => {
  const base = { listPrice: 750_000, listFromPrice: 500_000, wholesalePrice: 600_000, wholesaleFromPrice: 450_000, minimumPrice: 400_000 };
  assert.equal(inventoryPriceWarning(base), null);
  assert.equal(inventoryPriceWarning({ ...base, listPrice: 0, minimumPrice: 900_000 }), null);
  assert.equal(
    inventoryPriceWarning({ ...base, wholesalePrice: 800_000 }),
    "El precio mayorista supera al de lista.",
  );
  assert.equal(
    inventoryPriceWarning({ ...base, minimumPrice: 800_000 }),
    "El precio mínimo supera al de lista.",
  );
  assert.equal(
    inventoryPriceWarning({ ...base, listFromPrice: 800_000 }),
    "El precio final desde esos días supera al normal.",
  );
  assert.equal(
    inventoryPriceWarning({ ...base, wholesaleFromPrice: 700_000 }),
    "El precio mayorista desde esos días supera al normal.",
  );
  // Varios avisos se muestran juntos, sin bloquear.
  assert.equal(
    inventoryPriceWarning({ ...base, listPrice: 500_000, wholesalePrice: 600_000, minimumPrice: 700_000 }),
    "El precio mayorista supera al de lista. El precio mínimo supera al de lista.",
  );
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

test("monto PYG: el campo se dibuja con separadores y avisa si supera el tope", () => {
  assert.equal(moneyInputDisplay("89898999"), "89.898.999");
  assert.equal(moneyInputDisplay("1000"), "1.000");
  assert.equal(moneyInputDisplay(""), "");
  assert.equal(amountExceeds("10000000000", FIELD_LIMITS.amountGeneral), false);
  assert.equal(amountExceeds("10000000001", FIELD_LIMITS.amountGeneral), true);
  assert.equal(moneyInputMaxLength(FIELD_LIMITS.amountGeneral), 14); // 11 dígitos + 3 separadores
  // El caret no salta al final cuando el formateo agrega separadores.
  assert.equal(caretAfterDigits("1.234", 3), 4);
  assert.equal(caretAfterDigits("1.234", 4), 5);
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

/**
 * PIN del panel (issues #21 y #54): de 4 a 6 dígitos, con envío automático al
 * completarlo y una pausa que no corta a quien va a escribir 6.
 */

test("PIN: acepta de 4 a 6 dígitos y capa el pegado", () => {
  assert.equal(PIN_MIN_DIGITS, 4);
  assert.equal(PIN_MAX_DIGITS, 6);
  assert.equal(pinInput("12"), "12");
  assert.equal(pinInput("1234"), "1234");
  assert.equal(pinInput("123456"), "123456");
  assert.equal(pinInput("1234567"), "123456");
  assert.equal(pinInput("12 34-56"), "123456");
  assert.equal(pinInput("abc"), "");
  assert.equal(pinValid("123"), false);
  assert.equal(pinValid("1234"), true);
  assert.equal(pinValid("12345"), true);
  assert.equal(pinValid("123456"), true);
  assert.equal(pinValid("1234567"), false);
  assert.equal(pinValid(""), false);
});

test("PIN: el envío automático espera la pausa y no corta a quien escribe 6", () => {
  // Menos del mínimo: nunca se envía.
  assert.equal(pinEntryComplete("123", PIN_SETTLE_MS), false);
  // Cuatro dígitos recién tecleados: puede seguir con dos más (no se corta).
  assert.equal(pinEntryComplete("1234", 0), false);
  // Cuatro dígitos y pausa: el PIN corto se envía solo (issue #54).
  assert.equal(pinEntryComplete("1234", PIN_SETTLE_MS), true);
  // Seis dígitos: se envía al instante, sin esperar la pausa.
  assert.equal(pinEntryComplete("123456", 0), true);
  assert.equal(pinEntryComplete("12345", PIN_SETTLE_MS), true);
});

test("PIN: con largo conocido (repetir el nuevo) manda ese largo", () => {
  assert.equal(pinEntryComplete("1234", 0, 4), true);
  assert.equal(pinEntryComplete("1234", PIN_SETTLE_MS, 6), false);
  assert.equal(pinEntryComplete("123456", 0, 6), true);
  // Un largo fuera del rango permitido se ignora y cae al máximo.
  assert.equal(pinEntryComplete("1234", PIN_SETTLE_MS, 3), true);
  assert.equal(pinEntryComplete("1234", PIN_SETTLE_MS, 9), true);
});

/**
 * Catálogo con búsqueda del alta de presupuestos (issue #88): el combobox vive
 * en el kit de campos (un solo objeto, con teclado y aria) y el alta lo usa
 * para cliente y evento, con el alta rápida disponible desde el listado.
 */
const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("el catálogo del alta usa el Combobox del kit y no un select plano", () => {
  const fields = repoFile("components/admin/AdminFields.tsx");
  assert.match(fields, /export function Combobox\(/);
  assert.match(fields, /role="combobox"/);
  assert.match(fields, /aria-autocomplete="list"/);
  assert.match(fields, /aria-activedescendant/);
  assert.match(fields, /matchesQuery\(query/);

  const module = repoFile("components/admin/modules/PresupuestosModule.tsx");
  assert.match(module, /<Combobox\s+label="Cliente"/);
  assert.match(module, /<Combobox\s+label="Evento"/);
  // El alta rápida del diálogo sale de las llamadas `onCreate` del listado.
  assert.match(module, /onCreate=\{canCreateClient/);
  assert.match(module, /onCreate=\{canCreateEvent/);
  // El cliente usa los campos mínimos del selector (issue #62).
  assert.match(module, /useClientSelector\(form\.clientId\)/);
  assert.match(module, /onSearch=\{clients\.onSearch\}/);
  // Cliente y evento ya no se eligen con el select plano.
  assert.doesNotMatch(module, /<SelectField/);
});
