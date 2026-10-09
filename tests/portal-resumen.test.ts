import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Portal del cliente (issue #144): resumen con total, vencimiento y acceso a la
 * decisión; plan de pagos en tarjetas en mobile; Cronología y detalle del
 * resumen plegados; orden productos → total → condiciones → decisión; menos
 * mayúsculas; y pantalla de éxito post-autorización con próximos pasos y
 * descarga. Solo presentación: la lógica de aprobación no se toca.
 */
const root = process.cwd();
const view = readFileSync(join(root, "app", "(portal)", "_components", "PortalBudgetView.tsx"), "utf8");
const statics = readFileSync(join(root, "app", "(portal)", "_components", "PortalBudgetStatic.tsx"), "utf8");
const css = readFileSync(join(root, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("el resumen muestra total, vencimiento y acceso a la decisión", () => {
  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]{0,400}\.portal-budget-aside \{ position: sticky/, "el resumen de escritorio no es sticky");
  assert.match(view, /Ir a la decisión/, "el resumen no lleva a la decisión");
  assert.match(view, /portal-mobile-sticky-due/, "la barra móvil no muestra el vencimiento");
  assert.match(css, /\.portal-mobile-sticky-due/, "falta el estilo del vencimiento en la barra");
});

test("el plan de pagos propuesto se lee como tarjetas en mobile", () => {
  assert.match(view, /data-label="Vencimiento"/, "las cuotas no declaran el vencimiento para la ficha");
  assert.match(view, /data-label="Monto"/, "las cuotas no declaran el monto para la ficha");
  assert.match(css, /\.portal-table--plan:not\(\.portal-table--expected\) \{ min-width: 0; \}/, "el plan propuesto sigue con ancho mínimo");
  assert.match(css, /\.portal-table--plan:not\(\.portal-table--expected\) td::before \{ content: attr\(data-label\)/, "la ficha no dibuja la etiqueta del dato");

  const mobilePlan = [...css.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)]
    .find(([, rules]) => rules.includes(".portal-table--plan:not(.portal-table--expected) { min-width: 0; }"))?.[1] ?? "";
  const dueCell = /\.portal-table--plan:not\(\.portal-table--expected\) td\[data-label="Vencimiento"\] \{([^}]*)\}/.exec(mobilePlan)?.[1] ?? "";
  const countdown = /\.portal-table--plan:not\(\.portal-table--expected\) td\[data-label="Vencimiento"\] \.portal-countdown \{([^}]*)\}/.exec(mobilePlan)?.[1] ?? "";
  assert.match(dueCell, /flex-wrap: wrap;/, "mobile proposed-plan due dates must wrap their flex content");
  assert.match(countdown, /min-width: 0;/, "the scoped countdown must be able to shrink");
  assert.match(countdown, /max-width: 100%;/, "the scoped countdown must stay within its due-date cell");
  assert.match(countdown, /margin-left: 0;/, "a wrapped countdown must not overflow through its global margin");
  assert.match(countdown, /white-space: normal;/, "the scoped countdown text must wrap");
  assert.match(countdown, /overflow-wrap: anywhere;/, "long countdown words must remain readable without overflow");
  for (const rule of [dueCell, countdown]) {
    assert.doesNotMatch(rule, /overflow(?:-[xy])?:\s*(?:hidden|clip)|text-overflow:\s*ellipsis|line-clamp|display:\s*none|visibility:\s*hidden/, "payment reflow must not hide, clip or truncate content");
  }
  const globalCountdown = /(?:^|\n)\.portal-countdown \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(globalCountdown, /white-space: nowrap;/, "the global/desktop countdown behavior must remain unchanged");
});

test("Cronología y detalle del resumen quedan plegados", () => {
  assert.match(statics, /<details className="portal-card portal-disclosure"/, "la cronología no es plegable");
  assert.match(statics, /portal-disclosure-hint/, "la cronología no resume lo que hay adentro");
  assert.match(view, /portal-disclosure--inner/, "el resumen no tiene su detalle plegado");
  assert.match(css, /\.portal-disclosure\[open\] > summary::after/, "la sección plegada no indica el estado");
});

test("el orden del recorrido es productos → condiciones → decisión", () => {
  const terms = view.indexOf('aria-labelledby="portal-terms"');
  const items = view.indexOf('aria-labelledby="portal-items"');
  const action = view.indexOf('aria-labelledby="portal-action"');
  assert.ok(items > 0 && terms > 0 && action > 0, "faltan secciones del recorrido");
  assert.ok(items < terms, "las condiciones tienen que ir después de los productos");
  assert.ok(terms < action, "la decisión tiene que ir después de las condiciones");
});

test("menos secciones en mayúsculas y sin explicaciones repetidas", () => {
  const cardTitle = /\.portal-card-title \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.doesNotMatch(cardTitle, /text-transform: uppercase/, "los títulos de sección siguen en mayúsculas");
  assertEqualsNoUppercase(css, ".portal-banner-title");
  // El formulario de decisión ya no repite el mismo aviso dos veces.
  const form = view.slice(view.indexOf('id="portal-action"'), view.indexOf("</form>", view.indexOf('id="portal-action"')));
  assert.equal((form.match(/portal-submit-state/g) ?? []).length, 1, "el estado del envío quedó duplicado");
});

function assertEqualsNoUppercase(cssText: string, selector: string) {
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(cssText)?.[1] ?? "";
  assert.ok(rule, `falta la regla ${selector}`);
  assert.doesNotMatch(rule, /text-transform: uppercase/, `${selector} sigue en mayúsculas`);
}

test("post-autorización: éxito con próximos pasos y descarga", () => {
  assert.match(view, /portal-success-steps/, "falta la lista de próximos pasos");
  assert.match(view, /Estos son los próximos pasos:/, "el éxito no anuncia los próximos pasos");
  assert.match(view, /Descargar el presupuesto \(PDF\)/, "falta la descarga del presupuesto autorizado");
});

test("quote removal is an accessible compact icon after subtotal", () => {
  const rows = view.slice(view.indexOf("{budget.items.map((item) => {"));
  assert.ok(rows.indexOf('data-label="Subtotal"') < rows.indexOf('className="portal-item-action-cell"'), "action follows subtotal");
  assert.match(rows, /<AdminIcon name=\{current\.excluded \? "refresh" : "trash"\} size=\{18\} \/>/);
  assert.match(rows, /title=\{`\$\{current\.excluded \? "Restaurar" : "Retirar"\} \$\{item\.name\}`\}/);
  assert.match(view, /<span className="sr-only">Acción<\/span>/);
  assert.match(css, /\.portal-item-action \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(css, /\.portal-item-action:focus-visible/);
  assert.match(css, /\.portal-item-action \{ width: 44px; height: 44px; \}/);
});

test("quote and signature item cards reflow without a horizontal scrolling container", () => {
  const sheet = readFileSync(join(root, "app", "(portal)", "_components", "SignatureDocumentSheet.tsx"), "utf8");
  for (const source of [view, sheet]) assert.match(source, /className="portal-items-wrap"/);
  assert.match(css, /\.portal-items-wrap \{[^}]*min-width: 0;[^}]*overflow: visible;/);
  assert.match(css, /\.portal-table--items \{[^}]*min-width: 0;/);
  assert.match(css, /\.portal-table--items tbody tr \{[^}]*display: grid;[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /\.portal-table--items td\.portal-item-cell \{[^}]*grid-column: 1 \/ -1;/);
  assert.match(css, /\.portal-table--items td\[data-label="Subtotal"\] \{[^}]*grid-column: 1 \/ -2;/);
  assert.match(css, /\.portal-table--items td\.portal-item-action-cell \{[^}]*grid-column: -2 \/ -1;/);
  assert.match(css, /\.portal-table--items td \{[^}]*overflow-wrap: anywhere;/);
  assert.doesNotMatch(css, /\.portal-table--items \{ min-width: 36rem;/);
});

test("long proposal total labels cannot widen the quote item card", () => {
  assert.match(css, /\.portal-card:has\(\.portal-items-wrap\),[^}]+min-width: 0;/);
  assert.match(css, /\.portal-card:has\(\.portal-items-wrap\) \.portal-total-row > span:first-child \{ min-width: 0; overflow-wrap: anywhere;/);
});

test("excluded quote review CTA cannot force the item's parent grid wider on narrow screens", () => {
  assert.match(css, /\.portal-budget-main:has\(\.portal-items-wrap\) \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.portal-budget-main:has\(\.portal-items-wrap\) \.portal-btn--block \{ white-space: normal; overflow-wrap: anywhere;/);
});

test("quote document separates verbatim observations, payment terms, conditions and actual issuer", (t) => {
  assert.doesNotMatch(view, /\{budget\.notes \? <p className="portal-note">\{budget\.notes\}<\/p> : null\}/);
  assert.match(view, /aria-labelledby="portal-observations"/);
  assert.match(view, /className="quote-document-copy">\{budget.notes\}/);
  assert.ok(view.indexOf('aria-labelledby="portal-items"') < view.indexOf('aria-labelledby="portal-observations"'));
  assert.match(view, /portal-card quote-document-section--payments/);
  assert.match(view, /aria-labelledby="portal-issuer"/);
  assert.match(view, /Emitido por/);
  assert.match(view, /\{budget.organization\}/);
  const editor = readFileSync(join(root, "components/admin/modules/BudgetPricingDialog.tsx"), "utf8");
  const planEditor = readFileSync(join(root, "components/admin/modules/BudgetPaymentPlanEditor.tsx"), "utf8");
  const installmentDateFormatter = /(formatDayKey)\(row\.dueAt\)/.exec(planEditor)?.[1] ?? "";
  assert.ok(["formatDate", "formatDayKey"].includes(installmentDateFormatter), "the readonly installment must use an existing date formatter");
  const dateChecks = ["America/Asuncion", "UTC"].map((timeZone) => {
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { formatDate, formatDayKey } from "./lib/admin-format.ts";
      console.log(JSON.stringify({ displayed: ${installmentDateFormatter}("2026-10-19"), calendarDay: formatDayKey("2026-10-19") }));
    `], { cwd: root, env: { ...process.env, TZ: timeZone }, encoding: "utf8" });
    return { timeZone, ...JSON.parse(output) as { displayed: string; calendarDay: string } };
  });
  for (const { timeZone, displayed, calendarDay } of dateChecks) {
    t.diagnostic(`TZ=${timeZone}: readonly installment=${displayed}; existing formatDayKey=${calendarDay}`);
  }
  for (const { timeZone, displayed, calendarDay } of dateChecks) {
    assert.match(calendarDay, /^19\s+oct\.?\s+2026$/i, `${timeZone}: the existing date-only helper must preserve 19 October`);
    assert.equal(displayed, calendarDay, `${timeZone}: readonly installment must display the canonical calendar day, not 18 October`);
    assert.doesNotMatch(displayed, /^18\b/, `${timeZone}: the installment date must not shift to the previous day`);
  }
  const dateImport = /^import \{([^}]+)\} from "@\/lib\/admin-format";/m.exec(planEditor)?.[1] ?? "";
  assert.match(dateImport, /\bformatDayKey\b/, "the dialog must import the existing date-only helper");
  assert.match(planEditor, /formatDayKey\(row\.dueAt\)/, "the installment preview must use the date-only helper");
  for (const name of ["observations", "payments", "conditions", "issuer"]) {
    assert.match(editor, new RegExp(`quote-document-section quote-document-section--${name}`));
  }
  assert.match(editor, /budget.paymentTerms \|\| "Sin condiciones de pago registradas."/);
  assert.match(editor, /\{organization.name\}/);
  assert.match(css, /\.quote-document-copy \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);

  const adminDocument = /(?:^|\n)\.admin-root \.quote-document-section \{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const [shared, admin] of [["surface", "panel"], ["border", "line"], ["text", "text"], ["text-strong", "text-strong"]]) {
    assert.match(adminDocument, new RegExp(`--${shared}:\\s*var\\(--a-${admin}\\);`), `admin quote sections must map --${shared}`);
  }
  assert.match(adminDocument, /color: var\(--text\);/, "unclassed payment advance text must inherit the mapped admin color");
  assert.match(css, /(?:^|\n)\.admin-root \.quote-document-section \.admin-field-label \{[^}]*color: var\(--text\);/, "observation labels must use the mapped admin color");
  assert.match(css, /(?:^|\n)\.admin-root \.quote-document-section \.admin-dialog-text \{[^}]*color: var\(--text\);/, "payment and issuer helper copy must use the mapped admin color");
  assert.match(css, /(?:^|\n)\.quote-document-section \{[^}]*border: 1px solid var\(--border\);/);
  for (const name of ["observations", "payments"]) {
    assert.match(css, new RegExp(`(?:^|\\n)\\.quote-document-section--${name} \\{[^}]*background: color-mix\\([^;]*var\\(--surface\\)\\);`));
  }
  assert.match(css, /(?:^|\n)\.quote-document-section--conditions \{[^}]*border-inline-start: 4px solid var\(--border\);/);
  assert.match(css, /(?:^|\n)\.quote-document-section--issuer \{[^}]*border-block-start: 2px solid var\(--border\);/);
  assert.match(css, /(?:^|\n)\.quote-document-copy \{[^}]*color: var\(--text\);/);
  assert.match(css, /(?:^|\n)\.quote-document-subtitle \{[^}]*color: var\(--text-strong\);/);
  for (const [, selectors, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/--(?:surface|border|text|text-strong):\s*var\(--a-(?:panel|line|text|text-strong)\)/.test(declarations)) {
      assert.ok(selectors.split(",").every((selector) => selector.trim() === ".admin-root .quote-document-section"), "quote token aliases must not change portal or root themes");
    }
  }
});
