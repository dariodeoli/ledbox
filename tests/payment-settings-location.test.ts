import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("datos de pago tienen un solo editor/API, central en Bancos y cuentas y acceso compatible en presupuesto", () => {
  const company = read("components/admin/modules/EmpresaModule.tsx");
  assert.doesNotMatch(company, /<AdminPanel title="Datos de pago"/);
  assert.doesNotMatch(company, /href="\/presupuestos"/);
  const finance = read("components/admin/modules/FinanzasModule.tsx");
  assert.match(finance, /label: "Bancos y cuentas"/); assert.match(finance, /title="Datos para recibir pagos"/);
  assert.match(finance, /canManageOrganization\(role\) \? <AdminPanel title="Datos para recibir pagos"/);
  assert.match(finance, /paymentDetailsOpen && canManageOrganization\(role\)/);
  for (const path of ["components/admin/modules/FinanzasModule.tsx", "components/admin/modules/PresupuestosModule.tsx"]) {
    const module = read(path); assert.match(module, /import \{ PaymentDetailsDialog \} from "\.\/PaymentDetailsDialog"/);
    assert.doesNotMatch(module, /function PaymentDetailsDialog/);
  }
  const editor = read("components/admin/modules/PaymentDetailsDialog.tsx");
  assert.match(editor, /adminSend.*organization\/payment-details/);
  assert.doesNotMatch(editor, /adminSend.*(?:treasury|finance|transfer)/);
  const api = read("app/api/admin/organization/payment-details/route.ts");
  assert.match(api, /role === "OWNER" \|\| role === "ADMIN"/);
  assert.match(api, /if \(!ownerOrAdmin\(auth.context.role\)\) return jsonError\("Forbidden", 403\)/);
});
