import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPortalCompany, portalActionColor, portalBrandVars, PORTAL_ACTION_FALLBACK, PORTAL_BG } from "../lib/portal-company";
import { contrastRatio } from "../lib/storefront-theme";
import { portalHowToPay } from "../lib/portal-view";

const css = readFileSync("app/globals.css", "utf8");
const view = readFileSync("app/(portal)/_components/PortalBudgetView.tsx", "utf8");
const contact = readFileSync("app/(portal)/_components/PortalCompany.tsx", "utf8");

test("el color de acción usa marca apta o azul AA; nunca grises", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const hex of [null, "", "invalid", "#000000", "#ffffff", "#888888", "#111111"]) {
      assert.deepEqual(portalActionColor(hex, theme), PORTAL_ACTION_FALLBACK[theme]);
    }
    for (const r of [0, 51, 102, 153, 204, 255]) {
      for (const g of [0, 51, 102, 153, 204, 255]) {
        for (const b of [0, 51, 102, 153, 204, 255]) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const action = portalActionColor(hex, theme);
          assert.ok(contrastRatio(action.bg, action.on) >= 4.5, `${theme} texto ${hex}`);
          assert.ok(contrastRatio(action.bg, PORTAL_BG[theme]) >= 3, `${theme} control ${hex}`);
          assert.ok(!/^#([0-9a-f]{2})\1\1$/i.test(action.bg), `${theme} gris ${hex}`);
        }
      }
    }
  }
  assert.equal(portalActionColor("#0066cc", "light").bg, "#0066cc");
  assert.equal(portalActionColor("#0066cc", "dark").bg, "#0066cc");
});

test("tokens del botón y opción elegida consumen el mismo acento en ambos temas", () => {
  const company = buildPortalCompany({ name: "Ejemplo", profile: null, appearance: null, accent: "#0066cc" });
  const vars = portalBrandVars(company);
  for (const [theme, key] of [["light", "l"], ["dark", "d"]] as const) {
    const action = portalActionColor("#0066cc", theme);
    assert.equal(vars[`--pb-a-${key}`], action.bg);
    assert.equal(vars[`--pb-a-${key}-on`], action.on);
  }
  assert.match(css, /\.portal-btn--primary \{[^}]*background: var\(--p-action\);[^}]*color: var\(--p-action-ink\)/);
  assert.match(css, /\.portal-decision-option\[data-active="true"\] \{[^}]*border-color: var\(--p-action\)/);
  assert.match(css, /\.portal-decision-option\[data-active="true"\] \.portal-decision-option-mark \{[^}]*background: var\(--p-action\)/);
  assert.match(css, /--pb-act: var\(--pb-a-d\)/);
  assert.match(css, /--pb-act: var\(--pb-a-l\)/);
});

test("las anclas dejan visible el título bajo el encabezado y el resumen muestra condiciones reales", () => {
  assert.match(css, /\.portal \[id\], \.portal-card, \.portal-banner \{ scroll-margin-top: calc\(var\(--portal-top-h\) \+ 8px\)/);
  assert.match(view, /href="#portal-pay"/);
  assert.match(view, /aria-controls="portal-action"/);
  assert.match(view, /<dd className="portal-summary-terms">\{budget.paymentPlan.terms\}<\/dd>/);
  assert.match(view, /summaryCard\("portal-summary-mobile", false\)/);
  assert.match(view, /summaryCard\("portal-summary", true\)/);
});

test("resumen de seña respeta montos reales sin inventar fecha de saldo", () => {
  const plan = { advanceAmount: 300000, installments: [] };
  const label = portalHowToPay(plan, 1000000)!;
  assert.match(label, /30 %/);
  assert.match(label, /saldo según el plan de pagos/);
  assert.doesNotMatch(label, /antes de la entrega|50 %/);
  assert.doesNotMatch(portalHowToPay({ ...plan, advanceAmount: 333333 }, 1000000)!, /33 %/);
  assert.equal(portalHowToPay(plan, 0), null);
});

test("contacto tiene canales reconocibles y mensaje con referencia", () => {
  for (const icon of ["whatsapp", "map-pin", "phone", "instagram", "mail"]) assert.ok(contact.includes(`name="${icon}"`));
  assert.match(contact, /whatsappHref\(contact.whatsapp, waMessage\)/);
  assert.match(contact, /presupuesto Nº \$\{reference\}/);
  assert.match(contact, /phones.map\(\(phone\) => \([\s\S]*?<li key=\{phone\}>/);
  assert.match(contact, /@\{contact.instagram\}/);
});

test("cantidad y días conservan etiqueta y control juntos con tamaño compacto", () => {
  assert.match(view, /className="portal-quantity-group"><span className="portal-quantity-label">Cantidad/);
  assert.match(view, /className="portal-quantity-group"><span className="portal-quantity-label">Días/);
  assert.match(css, /\.portal-quantity-group \{ display: grid;/);
  assert.match(css, /\.portal-table--items \.portal-step \{ width: 30px; height: 32px;/);
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*?\.portal-table--items \.portal-step \{ width: 44px; height: 44px;/);
  assert.match(css, /\.portal-table--items td \{ justify-content: flex-start; \}/);
});
