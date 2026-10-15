import assert from "node:assert/strict";
import { test } from "node:test";
import { adminApiGet, adminSend, clearAdminApiCache } from "../lib/admin-api";

/** Respuestas diferidas: prueba el orden real de red, sin timers de carreras. */
test("un GET anterior a una mutación no vuelve a poblar la caché", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { setTimeout, clearTimeout } });
  const requests: Array<{ path: string; resolve: (value: Response) => void }> = [];
  globalThis.fetch = ((path: string) => new Promise<Response>((resolve) => requests.push({ path, resolve }))) as typeof fetch;
  const answer = (index: number, payload: unknown) => requests[index].resolve(Response.json(payload));
  try {
    clearAdminApiCache();
    const stale = adminApiGet("/api/admin/test-resource");
    const mutation = adminSend("/api/admin/test-resource", { name: "nuevo" });
    answer(1, { saved: true });
    assert.equal((await mutation).ok, true);
    const current = adminApiGet("/api/admin/test-resource");
    answer(2, { value: "nuevo" });
    assert.deepEqual(await current, { ok: true, data: { value: "nuevo" } });
    answer(0, { value: "viejo" });
    await stale;
    assert.deepEqual(await adminApiGet("/api/admin/test-resource"), { ok: true, data: { value: "nuevo" } });
    assert.equal(requests.length, 3, "la lectura en caché mantiene el valor posterior a la mutación");

    clearAdminApiCache();
    const a = adminApiGet("/api/admin/shared");
    const b = adminApiGet("/api/admin/shared");
    assert.equal(requests.length, 4, "las lecturas simultáneas idénticas comparten red");
    answer(3, { value: 1 });
    assert.deepEqual(await a, await b);

    clearAdminApiCache();
    const old = adminApiGet("/api/admin/shared");
    clearAdminApiCache();
    const fresh = adminApiGet("/api/admin/shared");
    answer(4, { value: "antes" });
    await old;
    const joined = adminApiGet("/api/admin/shared");
    assert.equal(requests.length, 6, "la respuesta vieja no borra ni contamina el GET nuevo en vuelo");
    answer(5, { value: "después" });
    assert.deepEqual(await fresh, await joined);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
    clearAdminApiCache();
  }
});
