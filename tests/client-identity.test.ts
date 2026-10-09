import assert from "node:assert/strict";
import { test } from "node:test";
import { clientDisplayName, clientLegalName } from "../lib/client-identity";

test("identidad comercial usa fantasía explícita y preserva fallback histórico", () => {
  assert.equal(clientDisplayName({ name: "Nombre histórico", tradeName: " Marca comercial " }), "Marca comercial");
  assert.equal(clientDisplayName({ name: "Nombre histórico", company: "Empresa histórica" }), "Nombre histórico");
  assert.equal(clientDisplayName({ name: "Nombre histórico", tradeName: " " }), "Nombre histórico");
});

test("identidad fiscal no infiere razón social desde company, fantasía ni contacto", () => {
  assert.equal(clientLegalName({ name: "Persona", tradeName: "Marca", company: "Empresa histórica" }), null);
  assert.equal(clientLegalName({ name: "Persona", legalName: " Sociedad EAS " }), "Sociedad EAS");
});
