import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  MessageTemplateRenderError,
  messageTemplateVariableKeys,
  previewMessageTemplate,
  renderMessageTemplate,
  sanitizeMessageTemplateBody,
  validateMessageTemplate,
} from "../lib/server/message-templates";
import { MESSAGE_TEMPLATE_CATEGORIES } from "../lib/admin-types";

/**
 * Plantillas de mensajes (issue #35): el render es una sola fuente y nunca deja
 * `{{...}}` sin completar; si falta un dato falla claro con la variable. Las
 * plantillas de arranque se renderizan con los datos de ejemplo de su categoría.
 */

test("render completa todas las variables con los datos reales", () => {
  const text = renderMessageTemplate(
    "Hola {{cliente}}: el total es {{monto}} y vence el {{vencimiento}}.",
    { cliente: "Eventos del Sur", monto: "Gs. 1.000.000", vencimiento: "30/09/2026" },
  );
  assert.equal(text, "Hola Eventos del Sur: el total es Gs. 1.000.000 y vence el 30/09/2026.");
  assert.equal(/\{\{|\}\}/.test(text), false);
});

test("render falla claro si falta un dato y nombra la variable", () => {
  assert.throws(
    () => renderMessageTemplate("Hola {{cliente}}: total {{monto}}.", { cliente: "Ana" }),
    (error: unknown) => {
      assert.ok(error instanceof MessageTemplateRenderError);
      assert.equal(error.variable, "monto");
      assert.match(error.message, /Falta el dato «Monto» \(\{\{monto\}\}\)/);
      return true;
    },
  );
  // Un valor vacío o en blanco también es un dato faltante.
  assert.throws(() => renderMessageTemplate("Hola {{cliente}}.", { cliente: "   " }), MessageTemplateRenderError);
});

test("render rechaza llaves sueltas: nunca sale un {{...}} visible", () => {
  assert.throws(
    () => renderMessageTemplate("Hola {{cliente}: total.", { cliente: "Ana" }),
    MessageTemplateRenderError,
  );
});

test("saneo: fin de línea único, sin controles, sin líneas vacías de más y variables canónicas", () => {
  const clean = sanitizeMessageTemplateBody("Hola {{ Cliente }}:\r\n\r\n\r\n\r\nTotal {{  monto  }}\u0000   \r\n\r\n");
  assert.equal(clean, "Hola {{cliente}}:\n\nTotal {{monto}}");
  assert.equal(sanitizeMessageTemplateBody("  \n\n\n  "), "");
});

test("validación: título, cuerpo vacío, variable desconocida y llaves mal escritas", () => {
  assert.equal(validateMessageTemplate({ title: "A", body: "Hola {{cliente}}", category: "client" }), "El título es obligatorio (mínimo 2 caracteres).");
  assert.equal(validateMessageTemplate({ title: "Saludo", body: "   ", category: "client" }), "El mensaje no puede estar vacío.");
  assert.match(
    validateMessageTemplate({ title: "Saludo", body: "Hola {{monto}}", category: "client" }) ?? "",
    /La variable «\{\{monto\}\}» no existe en esta categoría/,
  );
  assert.match(
    validateMessageTemplate({ title: "Saludo", body: "Hola {{cliente}", category: "client" }) ?? "",
    /Revisá las llaves/,
  );
  assert.equal(validateMessageTemplate({ title: "Saludo", body: "Hola {{cliente}}", category: "client" }), null);
});

test("variables detectadas: sin repetir y en orden de aparición", () => {
  assert.deepEqual(
    messageTemplateVariableKeys("{{cliente}} {{monto}} {{cliente}}"),
    ["cliente", "monto"],
  );
});

test("vista previa con datos de ejemplo: el mismo render, nunca lanza", () => {
  const ok = previewMessageTemplate("Hola {{cliente}}: {{link_portal}}", "collection");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(/\{\{/.test(ok.text), false);
  const bad = previewMessageTemplate("Hola {{empresa}}: {{link_portal}}", "client");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /no existe en esta categoría/);
});

test("plantillas de arranque: se renderizan con los datos de ejemplo de su categoría y no se repiten", () => {
  assert.ok(DEFAULT_MESSAGE_TEMPLATES.length >= 8);
  const seen = new Set<string>();
  for (const template of DEFAULT_MESSAGE_TEMPLATES) {
    assert.ok(MESSAGE_TEMPLATE_CATEGORIES.includes(template.category));
    const key = `${template.category}:${template.title}`;
    assert.equal(seen.has(key), false, `plantilla repetida: ${key}`);
    seen.add(key);
    const error = validateMessageTemplate({ title: template.title, body: template.body, category: template.category });
    assert.equal(error, null, `${key}: ${error}`);
    const preview = previewMessageTemplate(template.body, template.category);
    assert.equal(preview.ok, true, `${key}: ${preview.ok ? "" : preview.error}`);
    if (preview.ok) assert.equal(/\{\{|\}\}/.test(preview.text), false, key);
  }
});

test("cada categoría solo ofrece sus variables", () => {
  // `client` no tiene montos; `budget`/`collection` no tienen datos del evento.
  assert.match(validateMessageTemplate({ title: "Cliente", body: "{{monto}}", category: "client" }) ?? "", /no existe/);
  assert.match(validateMessageTemplate({ title: "Presupuesto", body: "{{evento}}", category: "budget" }) ?? "", /no existe/);
  assert.match(validateMessageTemplate({ title: "Cobranza", body: "{{lugar}}", category: "collection" }) ?? "", /no existe/);
});
