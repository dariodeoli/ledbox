import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";

test("panel de necesidades externas permite registrar solicitudes y aclara que no reservan stock", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { ExternalNeedsPanel } = await import("../components/admin/modules/EventoFicha");
  const html = renderToStaticMarkup(React.createElement(ExternalNeedsPanel, {
    eventId: "event-1",
    startsAt: "2031-05-10T10:00:00.000Z",
    endsAt: "2031-05-11T18:00:00.000Z",
    inventoryItems: [],
    onSearchInventory() {},
    writable: true,
  }));

  assert.match(html, /Suministro externo/);
  assert.match(html, /No reservado/);
  assert.match(html, /no confirma proveedor, cantidad recibida ni disponibilidad/);
  assert.match(html, /Producto o equipo solicitado/);
  assert.match(html, /Cantidad solicitada/);
  assert.match(html, /Registrar necesidad/);
  assert.match(html, /Inicio/);
  assert.match(html, /Fin/);
});

test("panel de necesidades externas no muestra acciones de escritura a perfiles de solo lectura", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { ExternalNeedsPanel } = await import("../components/admin/modules/EventoFicha");
  const html = renderToStaticMarkup(React.createElement(ExternalNeedsPanel, {
    eventId: "event-1",
    startsAt: null,
    endsAt: null,
    inventoryItems: [],
    onSearchInventory() {},
    writable: false,
  }));

  assert.match(html, /No reservado/);
  assert.doesNotMatch(html, /Registrar necesidad/);
});
