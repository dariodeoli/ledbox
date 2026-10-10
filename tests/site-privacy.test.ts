import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Política de privacidad (issue #92, Ley 7593/2025): página pública e indexable,
 * enlazada desde el footer del sitio y desde el formulario de consulta —antes
 * del botón—, y en el sitemap. Los datos societarios no se inventan: van como
 * `PENDIENTE-DUEÑO` hasta que el dueño los confirme.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const POLICY_PAGE = "app/(public)/privacidad/page.tsx";

test("la política existe, es pública y trae lo que pide la ley", () => {
  assert.ok(existsSync(join(root, POLICY_PAGE)), "falta la página /privacidad");
  const source = read(POLICY_PAGE);

  assert.match(source, /alternates: \{ canonical: "\/privacidad" \}/, "la URL canónica es /privacidad");
  assert.match(source, /PublicNav/, "usa la navegación del sitio");
  assert.match(read("app/layout.tsx"), /<PublicFooter \/>/, "el layout raíz usa el pie del sitio");

  // Contenido mínimo exigido por el issue.
  assert.match(source, /responsable del tratamiento/i);
  assert.match(source, /finalidad/i);
  assert.match(source, /base legal/i);
  assert.match(source, /minimización y conservación/i);
  assert.match(source, /destinatarios/i);
  assert.match(source, /tus derechos/i);
  for (const right of ["Acceso", "Rectificación", "Supresión", "Oposición", "Portabilidad", "Revocación del consentimiento"]) {
    assert.ok(source.includes(right), `falta el derecho de ${right}`);
  }
  assert.match(source, /30 días corridos/, "el plazo de respuesta queda explícito");
  assert.match(source, /Agencia Nacional de Protección de Datos Personales/, "menciona la autoridad de control");
  assert.match(source, /MITIC/, "la autoridad depende del MITIC");
  assert.match(source, /Ley 7593\/2025/, "cita la ley");
  assert.match(source, /\+595 982 029 217/, "el canal de contacto es el WhatsApp del dueño");
});

test("los datos societarios quedan pendientes: no se inventan", () => {
  const source = read(POLICY_PAGE);
  assert.match(source, /Razón social<\/dt><dd>PENDIENTE-DUEÑO/, "razón social pendiente");
  assert.match(source, /RUC<\/dt><dd>PENDIENTE-DUEÑO/, "RUC pendiente");
  assert.match(source, /Domicilio<\/dt><dd>PENDIENTE-DUEÑO/, "domicilio pendiente");
  assert.doesNotMatch(source, /\d{6,8}-\d/, "no hay RUC inventado o copiado sin confirmar");
});

test("la política se enlaza desde el footer del sitio", () => {
  const footer = read("components/public/PublicFooter.tsx");
  assert.match(footer, /<Link href="\/privacidad">Privacidad<\/Link>/, "el pie del sitio enlaza la política");
  assert.match(footer, /<AppFooter variant="company"/, "la navegación pública comparte el pie company y su crédito");
});

test("el formulario de consulta avisa la finalidad antes de enviar", () => {
  const source = read("components/leads/LeadCaptureDialog.tsx");
  const notice = source.indexOf("lead-consent");
  const submit = source.indexOf('type="submit"');
  assert.ok(notice > 0, "falta el aviso de finalidad");
  assert.ok(notice < submit, "el aviso va antes del botón de envío");
  assert.match(source, /href="\/privacidad" target="_blank" rel="noopener"/, "el aviso enlaza la política en otra pestaña");
  assert.match(source, /no los compartimos para publicidad/, "el aviso dice para qué se usan los datos");
  assert.match(source, /fetch\("\/api\/leads"/, "el contrato de /api/leads no cambió");
});

test("la política está en el sitemap del sitio", () => {
  const sitemap = read("app/sitemap.ts");
  assert.match(sitemap, /\$\{profile\.siteUrl\}\/privacidad/, "el sitemap lista /privacidad");
});
