#!/usr/bin/env node
/**
 * CLI de cargas por API key (issue #69): crea un cliente y su presupuesto desde
 * un JSON, con costos internos y margen, y opcionalmente le adjunta un archivo
 * local. No usa contraseñas: todo va con `Authorization: Bearer <token>`.
 *
 * Uso (necesita `tsx` para reutilizar la aritmética de `lib/budget-costs.ts`):
 *
 *   node --import tsx scripts/admin-api.mjs \
 *     --token lbx_xxx \
 *     [--url https://app.ledbox.online] \
 *     --file scripts/admin-api.example.json \
 *     [--attachment ./plano.pdf]
 *
 * También por entorno: `LEDBOX_API_URL` y `LEDBOX_API_TOKEN`.
 *
 * El precio final se resuelve con la misma regla que el panel:
 * `marginPercent` → `priceForMargin` (costo / (1 − margen/100)); si el precio
 * supera la suma de ítems, se reparte con `distributePrice`; si no, va como
 * descuento. Los costos internos nunca se envían al portal (el API los protege).
 */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { distributePrice, internalCostOf, marginOf, priceForMargin } from "../lib/budget-costs.ts";

const HELP = `Uso: node --import tsx scripts/admin-api.mjs --token <lbx_...> --file <carga.json> [--url <base>] [--attachment <archivo>]`;

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  return process.argv[index + 1] ?? "";
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function api(url, token, path, { method = "GET", body, form } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(form ? { body: form } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`${method} ${path} → ${response.status}: ${payload.error || response.statusText}`);
  }
  return payload;
}

/** Precio final del presupuesto con la regla compartida; devuelve ítems + descuento. */
function pricePlan(items, budget) {
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.quantity) * Math.round(item.days) * Math.round(item.unitPrice), 0);
  const explicit = Number(budget.finalPrice ?? 0);
  const internalCost = internalCostOf({
    materialCost: Number(budget.materialCost ?? 0),
    laborCost: Number(budget.laborCost ?? 0),
    items: items.map((item) => ({ quantity: item.quantity, days: item.days, costPrice: item.costPrice ?? 0 })),
  }).total;

  let target = explicit > 0 ? Math.round(explicit) : 0;
  if (!target && budget.marginPercent !== undefined && budget.marginPercent !== null) {
    target = priceForMargin(internalCost, Number(budget.marginPercent)) ?? 0;
    if (!target) fail("El margen no permite calcular un precio (revisá el costo o usá un margen entre 0 y 99,99).");
  }

  if (!target) return { items, discount: 0, subtotal, total: subtotal, internalCost, margin: marginOf(subtotal, internalCost) };
  if (target <= subtotal) {
    return { items, discount: subtotal - target, subtotal, total: target, internalCost, margin: marginOf(target, internalCost) };
  }
  const distributed = distributePrice(
    items.map((item) => ({ id: null, quantity: item.quantity, days: item.days, unitPrice: item.unitPrice })),
    target,
  );
  const raised = items.map((item, index) => ({ ...item, unitPrice: distributed.items[index].unitPrice }));
  return {
    items: raised,
    discount: 0,
    subtotal: distributed.subtotal,
    total: distributed.subtotal,
    internalCost,
    margin: marginOf(distributed.subtotal, internalCost),
  };
}

const url = (argValue("--url") || process.env.LEDBOX_API_URL || "https://app.ledbox.online").replace(/\/$/, "");
const token = argValue("--token") || process.env.LEDBOX_API_TOKEN || "";
const file = argValue("--file");
if (!token || !file || process.argv.includes("--help")) {
  console.log(HELP);
  if (!token || !file) process.exit(1);
  process.exit(0);
}

const raw = JSON.parse(await readFile(resolve(file), "utf8"));
if (!raw?.client?.name || !raw?.budget?.title || !Array.isArray(raw.budget.items) || raw.budget.items.length === 0) {
  fail("El JSON necesita client.name, budget.title y budget.items con al menos un ítem.");
}

console.log(`▌ LedBox · carga por API key\n  API: ${url}\n  Archivo: ${file}\n`);
console.log(`→ Creando el cliente «${raw.client.name}»…`);
const { client } = await api(url, token, "/api/admin/clients", { method: "POST", body: raw.client });
console.log(`  ✓ Cliente ${client.id}`);

const plan = pricePlan(raw.budget.items, raw.budget);
const budgetBody = {
  clientId: client.id,
  title: raw.budget.title,
  items: plan.items,
  discount: plan.discount,
  materialCost: Number(raw.budget.materialCost ?? 0),
  laborCost: Number(raw.budget.laborCost ?? 0),
  deliveryAt: raw.budget.deliveryAt ?? null,
  validUntil: raw.budget.validUntil ?? null,
  ivaType: raw.budget.ivaType ?? null,
  warranty: raw.budget.warranty ?? null,
  notes: raw.budget.notes ?? null,
};
console.log(`→ Creando el presupuesto «${raw.budget.title}»…`);
const { budget } = await api(url, token, "/api/admin/budgets", { method: "POST", body: budgetBody });
const marginText = plan.margin ? `${plan.margin.percent}% (Gs ${plan.margin.amount.toLocaleString("es-PY")})` : "—";
console.log(`  ✓ Presupuesto ${budget.id}`);
console.log(`    Items: ${plan.items.length} · Subtotal: Gs ${plan.subtotal.toLocaleString("es-PY")} · Descuento: Gs ${plan.discount.toLocaleString("es-PY")} · Total: Gs ${plan.total.toLocaleString("es-PY")}`);
console.log(`    Costo interno: Gs ${plan.internalCost.toLocaleString("es-PY")} · Margen: ${marginText}`);

const attachmentPath = argValue("--attachment") || raw.attachmentPath || "";
if (attachmentPath) {
  const absolute = resolve(attachmentPath);
  const bytes = await readFile(absolute);
  const form = new FormData();
  form.append("budgetId", budget.id);
  form.append("file", new File([bytes], basename(absolute)));
  console.log(`→ Adjuntando «${basename(absolute)}» (${(bytes.byteLength / 1024).toFixed(1)} kB)…`);
  const attachment = await api(url, token, "/api/admin/budgets/attachments", { method: "POST", form });
  console.log(`  ✓ Adjunto ${attachment.attachment?.id ?? ""} (${attachment.attachment?.mime ?? ""})`);
}

console.log("\n✓ Listo. Todo quedó auditado como «API · nombre de la clave».");
