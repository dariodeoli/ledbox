import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { kpiLoading, kpiState } from "../components/admin/kpi-state";

// El transform de tsx usa React.createElement en el componente.
(globalThis as { React?: typeof React }).React = React;
let AdminKpi: typeof import("../components/admin/AdminUI").AdminKpi;
let AdminKpis: typeof import("../components/admin/AdminUI").AdminKpis;
before(async () => {
  ({ AdminKpi, AdminKpis } = await import("../components/admin/AdminUI"));
});

const group = (props: { state?: "loading" | "error" | "ready" }, ...kids: React.ReactNode[]) =>
  createElement(AdminKpis, { ...props, children: kids });
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

test("value undefined o null muestra esqueleto y no un 0", () => {
  for (const value of [undefined, null]) {
    const out = html(createElement(AdminKpi, { label: "Eventos", value }));
    assert.match(out, /admin-kpi-skeleton/);
    assert.doesNotMatch(out, />0</);
  }
});

test("un 0 real cargado sigue siendo 0", () => {
  const out = html(group({ state: "ready" }, createElement(AdminKpi, { label: "Eventos", value: "0" })));
  assert.match(out, />0</);
  assert.doesNotMatch(out, /admin-kpi-skeleton/);
});

test("el grupo en carga pone esqueletos y un solo role=status", () => {
  const out = html(group({ state: "loading" }, createElement(AdminKpi, { label: "A", value: "0" }), createElement(AdminKpi, { label: "B", value: "0" })));
  assert.equal((out.match(/admin-kpi-skeleton/g) ?? []).length, 2);
  assert.equal((out.match(/role="status"/g) ?? []).length, 1);
  assert.match(out, /aria-busy="true"/);
});

test("con error y sin datos muestra «—» y no esqueleto", () => {
  const out = html(group({ state: "error" }, createElement(AdminKpi, { label: "A", value: "0" })));
  assert.match(out, /—/);
  assert.doesNotMatch(out, /admin-kpi-skeleton/);
  assert.match(out, /aria-busy="false"/);
});

test("loading={false} explícito pisa al grupo", () => {
  const out = html(group({ state: "loading" }, createElement(AdminKpi, { label: "A", value: "5", loading: false })));
  assert.match(out, />5</);
});

test("cada KPI espera solo su recurso", () => {
  const ok = { data: [], loading: false, error: "" };
  const failed = { data: null, loading: false, error: "x" };
  const out = html(group({}, createElement(AdminKpi, { label: "A", value: "3", state: kpiState(ok) }), createElement(AdminKpi, { label: "B", value: "0", state: kpiState(failed) })));
  assert.match(out, />3</);
  assert.match(out, /—/);
});

test("kpiLoading / kpiState", () => {
  const loading = { data: null, loading: true };
  const ok = { data: 1, loading: false };
  const reloading = { data: 1, loading: true };
  assert.equal(kpiLoading(loading), true);
  assert.equal(kpiLoading(reloading), false);
  assert.equal(kpiState(ok, loading), "loading");
  assert.equal(kpiState(ok, { data: null, loading: false, error: "e" }), "error");
  assert.equal(kpiState(ok, reloading), "ready");
});
