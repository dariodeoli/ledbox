import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { normalizarRuc, RUC_PATTERN, rucConForma } from "../lib/server/ruc";

/**
 * Consulta pública de RUC del sitio (issue #104): el endpoint `GET /api/ruc`
 * normaliza con la máscara del sitio (issue #101), valida la forma paraguaya y
 * consulta un proveedor configurado por entorno; si no lo hay o falla, el
 * formulario se completa a mano (`manualEntryAllowed`). Y el popup «Antes de
 * cotizar» usa los campos guiados sin romper honeypot, privacidad ni WhatsApp.
 */
const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

test("normaliza lo que llega por la URL con la máscara del sitio", () => {
  assert.equal(normalizarRuc(" 80012345-6 "), "80012345-6");
  assert.equal(normalizarRuc("800.12345-6"), "80012345-6");
  assert.equal(normalizarRuc("abc80012345-6"), "80012345-6");
  assert.equal(normalizarRuc("-80012345-6"), "80012345-6");
  assert.equal(normalizarRuc(null), "");
  assert.equal(normalizarRuc("80012345678901234567890"), "80012345678901234567"); // tope de la máscara
});

test("la forma del RUC es la paraguaya: 5 a 8 dígitos y verificador opcional", () => {
  for (const valido of ["12345", "80012345", "80012345-6", "1234567-8"]) assert.ok(rucConForma(valido), `${valido} debería ser válido`);
  for (const invalido of ["", "1234", "123456789", "80012345-", "abc12345", "8001234567-8"]) {
    assert.equal(rucConForma(invalido), false, `${invalido} no debería ser válido`);
    assert.equal(RUC_PATTERN.test(invalido), false);
  }
});

test("el endpoint público no filtra datos y habilita la carga manual", () => {
  const route = read("app/api/ruc/route.ts");
  assert.match(route, /export async function GET/, "es GET");
  assert.match(route, /rateLimit\(`ruc:consulta:\$\{getClientIp\(request\)\}`/, "cuota por IP");
  assert.match(route, /manualEntryAllowed: true/, "los errores habilitan la carga manual");
  assert.match(route, /proveedorRucConfigurado\(\)/, "sin proveedor responde claro");
  assert.doesNotMatch(route, /db\.|recordAudit|prisma/i, "sin traza de datos: la única huella es el rate-limit");
  const lib = read("lib/server/ruc.ts");
  assert.doesNotMatch(lib, /console\.(log|info)/, "no se registra el RUC consultado");
});

test("el popup usa los campos guiados y conserva lo demás", () => {
  const dialog = read("components/leads/LeadCaptureDialog.tsx");
  assert.match(dialog, /RucField as LibRucField/, "RUC con el componente de la librería");
  assert.match(dialog, /consultar={consultarRuc}/, "el RUC consulta el endpoint público");
  assert.match(dialog, /onAplicar=\{\(datos\) => setCompany\(datos\.name\)\}/, "la razón social se aplica solo al confirmar");
  assert.match(dialog, /fetch\(`\/api\/ruc\?numero=/, "llama al endpoint nuevo");
  assert.match(dialog, /EmailField as LibEmailField/, "correo con el componente de la librería");
  assert.match(dialog, /countryCode, setCountryCode\] = useState\("\+595"\)/, "el teléfono arranca en +595");
  assert.match(dialog, /<PhonePartsField\b/, "el teléfono reutiliza el adaptador compartido");
  const phone = read("components/fields/PhonePartsField.tsx");
  assert.match(phone, /CODIGOS_PAIS/, "el catálogo de códigos del adaptador es el de la librería");
  assert.match(phone, /soloDigitos/, "el adaptador usa la normalización compartida");
  assert.match(dialog, /name="website"/, "el honeypot sigue");
  assert.match(dialog, /Política de privacidad/, "el aviso de privacidad sigue");
  assert.match(dialog, /whatsappUrl\(text\)/, "el envío a WhatsApp sigue");
  assert.match(dialog, /ruc,/, "el RUC viaja en el alta (el API ya lo acepta)");
  assert.match(dialog, /Empresa</, "«Empresa / RUC» quedó separado en Empresa + RUC");
});
