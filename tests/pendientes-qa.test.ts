import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("eventos: el 409 de cierre trae código y la UI ofrece «Cerrar igual» con nota obligatoria, solo con permiso de escritura", () => {
  const api = read("app/api/admin/events/route.ts");
  assert.match(api, /409, "closure_blocked"/);
  const adminApi = read("lib/admin-api.ts");
  assert.match(adminApi, /return code \? \{ ok: false, error: message, code \}/);
  const ui = read("components/admin/modules/EventosModule.tsx");
  assert.match(ui, /result\.code === "closure_blocked"/);
  assert.match(ui, /Cerrar igual/);
  assert.match(ui, /forceClose: true, forceCloseNote: note/);
  assert.match(ui, /form=\{forceFormId\}/);
  assert.match(ui, /note\.length < 5 \|\| note\.length > 400/);
  assert.match(ui, /\{writable && closeBlock \?/);
  assert.match(ui, /const closable = writable &&/);
});
