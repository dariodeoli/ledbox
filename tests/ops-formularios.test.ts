import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
// Next compile JSX automáticamente; tsx respeta jsx:preserve (transformación clásica).
Object.assign(globalThis, { React });
const { EMPTY_CLIENT_QUICK, clientQuickErrors, clientQuickPayload } = require("../components/admin/modules/ClientQuickForm") as typeof import("../components/admin/modules/ClientQuickForm");
const { EMPTY_EVENT_QUICK, eventQuickError, eventQuickPayload, locationLinkValid } = require("../components/admin/modules/OperationQuickRules") as typeof import("../components/admin/modules/OperationQuickRules");

test("identidad comercial, fiscal e histórica se envían separadas sin inferir contactos", () => {
  const values = { ...EMPTY_CLIENT_QUICK, name: "Registro anterior", company: "Empresa anterior", tradeName: "Marca comercial", legalName: "Sociedad EAS", ruc: "80012345-6" };
  const payload = clientQuickPayload(values);
  assert.equal(payload.tradeName, "Marca comercial");
  assert.equal(payload.legalName, "Sociedad EAS");
  assert.equal(payload.name, "Registro anterior");
  assert.equal(payload.company, "Empresa anterior");
  assert.equal(payload.contactName, null);
  assert.deepEqual(payload.contacts, []);
});

test("alta comercial no impone un nombre humano ni envía snapshot editable", () => {
  const values = { ...EMPTY_CLIENT_QUICK, tradeName: "MARCA 2026 / OPERACIONES & SERVICIOS", rucConfirmationToken: "token-confirmado" };
  assert.equal(clientQuickErrors(values).name, null);
  const payload = JSON.parse(JSON.stringify(clientQuickPayload(values)));
  assert.equal("name" in payload, false);
  assert.equal("rucSnapshot" in payload, false);
  assert.equal(payload.confirmRuc, true);
  assert.equal(payload.rucConfirmationToken, "token-confirmado");
  assert.equal(clientQuickErrors({ ...values, name: "A".repeat(200) }).name, null);
  assert.notEqual(clientQuickErrors({ ...values, name: "A".repeat(201) }).name, null);
});

test("contactos por función se validan y no se convierten en identidad del cliente", () => {
  const values = { ...EMPTY_CLIENT_QUICK, name: "Marca", contacts: [{ name: "María González", role: "Facturación", phone: null, email: "maria@example.com" }] };
  assert.equal(clientQuickErrors(values).contacts, null);
  assert.deepEqual(clientQuickPayload(values).contacts, values.contacts);
  assert.equal(clientQuickErrors({ ...values, contacts: [{ ...values.contacts[0], email: "inválido" }] }).contacts !== null, true);
  assert.equal(clientQuickErrors({ ...values, contacts: Array.from({ length: 21 }, () => values.contacts[0]) }).contacts !== null, true);
});

test("ubicación permite http(s), rechaza credenciales y esquemas ejecutables", () => {
  assert.equal(locationLinkValid("https://maps.example.com/lugar"), true);
  for (const link of ["javascript:alert(1)", "https://user:pass@example.com", "data:text/html,test", "no es un enlace"]) assert.equal(locationLinkValid(link), false, link);
});

test("evento rápido requiere solo nombre; ciudad, recinto y contactos permanecen independientes", () => {
  const values = { ...EMPTY_EVENT_QUICK, name: "Lanzamiento" };
  assert.equal(eventQuickError(values), "");
  const payload = eventQuickPayload({ ...values, location: "Recinto", city: "Asunción", department: "Asunción", attendees: "0" });
  assert.equal(payload.location, "Recinto");
  assert.equal(payload.city, "Asunción");
  assert.equal(payload.attendees, 0);
  assert.equal(payload.venueContactName, null);
  assert.equal(payload.startsAt, null);
  assert.equal(eventQuickPayload(values).attendees, null);
  assert.equal("clientId" in eventQuickPayload({ ...values, clientId: "ajeno" } as typeof values), false);
});

test("evento impide rango invertido y asistentes inválidos sin exigir datos opcionales", () => {
  const values = { ...EMPTY_EVENT_QUICK, name: "Evento", startsAt: "2026-10-10T12:00", endsAt: "2026-10-10T11:00" };
  assert.match(eventQuickError(values), /fin no puede/);
  for (const attendees of ["-1", "2.5", "2147483648"]) assert.match(eventQuickError({ ...EMPTY_EVENT_QUICK, name: "Evento", attendees }), /asistentes/);
});

test("fecha ingresada conserva instante con zona explícita en el transporte", () => {
  const value = "2026-10-10T12:00";
  const payload = eventQuickPayload({ ...EMPTY_EVENT_QUICK, name: "Evento", startsAt: value });
  assert.equal(new Date(payload.startsAt!).getTime(), new Date(value).getTime());
  assert.match(payload.startsAt!, /Z$/);
  assert.match(eventQuickError({ ...EMPTY_EVENT_QUICK, name: "Evento", startsAt: "inválido" }), /fecha y hora/);
});
