import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clientDisplayName, clientPresentation } from "../lib/client-identity";
Object.assign(globalThis, { React });


const client = { id: "client-qa", name: "Ana Pérez", company: "Empresa histórica", tradeName: "Aurora Eventos", contactName: "Ana Pérez", type: "RESELLER", logoUpdatedAt: null };

test("presentación comercial prioriza fantasía/empresa y evita responsable duplicado", () => {
  assert.deepEqual(clientPresentation(client), { primary: "Aurora Eventos", responsible: "Ana Pérez", category: "Mayorista", description: "Ana Pérez · Mayorista" });
  assert.equal(clientPresentation({ ...client, tradeName: null }).primary, "Empresa histórica");
  assert.equal(clientPresentation({ ...client, tradeName: null, company: null }).primary, "Ana Pérez");
  assert.equal(clientPresentation({ ...client, name: " AURORA EVENTOS ", contactName: " aurora eventos " }).responsible, null);
  assert.equal(clientPresentation({ name: "Ana", contactName: "Ana", type: "FINAL" }).description, "Cliente final");
  assert.equal(clientPresentation({ name: "Empresa histórica", tradeName: "Marca comercial" }).responsible, null);
  assert.equal(clientPresentation({ name: "Sin segmento" }).category, null);
  assert.equal(clientDisplayName({ name: "Histórico", company: "Empresa" }), "Histórico", "los contratos y snapshots conservan su fallback histórico");
});

test("opción canónica mantiene ID, texto de búsqueda y contenido accesible completo", async () => {
  const { ClientIdentityView, ClientAvatar, clientComboboxOption } = await import("../components/admin/ClientIdentity");
  const option = clientComboboxOption(client);
  assert.equal(option.value, client.id); assert.equal(option.label, "Aurora Eventos");
  assert.equal(option.description, "Ana Pérez · Mayorista");
  assert.match(option.keywords!, /Empresa histórica/);
  const rendered = renderToStaticMarkup(createElement(ClientIdentityView, { client }));
  assert.match(rendered, /admin-avatar/); assert.match(rendered, /Aurora Eventos/);
  assert.match(rendered, /Ana Pérez/); assert.match(rendered, /Mayorista/);
  const logo = renderToStaticMarkup(createElement(ClientAvatar, { client: { ...client, logoUpdatedAt: "2026-10-15T12:00:00Z" } }));
  assert.match(logo, /\/api\/admin\/clients\/client-qa\/logo/);
  assert.match(logo, /referrerPolicy="no-referrer"/i);
});

test("combobox cerrado muestra la misma identidad conservando input textual y teclado", async () => {
  const { clientComboboxOption } = await import("../components/admin/ClientIdentity");
  const { Combobox } = await import("../components/admin/AdminFields");
  const html = renderToStaticMarkup(createElement(Combobox, { label: "Cliente", value: client.id, options: [clientComboboxOption(client)], onChange() {} }));
  assert.match(html, /data-rich-selection="true"/);
  assert.match(html, /admin-combobox-selected/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /value="Aurora Eventos"/);
  assert.match(html, /aria-description="Ana Pérez · Mayorista"/);
  assert.match(html, /admin-client-identity-type/);
});
