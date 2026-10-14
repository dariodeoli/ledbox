import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { isAdminRoute } from "../lib/admin-routes";

const env = process.env as Record<string, string | undefined>;
const originalEnv = env.NODE_ENV;
afterEach(() => {
  env.NODE_ENV = originalEnv;
});

function call(host: string, path: string, nodeEnv = "production") {
  env.NODE_ENV = nodeEnv;
  return middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
}

const CLIENT_HOSTS = ["clientes.ledbox.online", "demo.ledbox.online", "eventos.ledbox.online", "ledbox.online"];

test("en producción /superadmin y subrutas dan 307 a / del mismo host en clientes, demo, eventos y público", () => {
  for (const host of CLIENT_HOSTS) {
    for (const path of ["/superadmin", "/superadmin/", "/superadmin/empresas", "/superadmin/usuarios/exportar?q=a"]) {
      const response = call(host, path);
      assert.equal(response.status, 307, `${host}${path}`);
      assert.equal(response.headers.get("location"), `https://${host}/`, `${host}${path}`);
    }
  }
});

test("el host de la app deja pasar /superadmin (decide el guard)", () => {
  const response = call("app.ledbox.online", "/superadmin");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
});

test("el host viejo admin. sigue con su 308 a la app", () => {
  const response = call("admin.ledbox.online", "/superadmin/empresas");
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://app.ledbox.online/superadmin/empresas");
});

test("rutas parecidas no se tocan", () => {
  for (const host of CLIENT_HOSTS) {
    const response = call(host, "/superadministracion");
    assert.notEqual(response.status, 307, host);
  }
});

test("fuera de producción no redirige (localhost)", () => {
  const response = call("localhost:3000", "/superadmin", "development");
  assert.notEqual(response.status, 307);
  assert.equal(response.headers.get("location"), null);
});

test("/superadmin no está en ADMIN_ROUTES (el host público lo mandaría a la app)", () => {
  assert.equal(isAdminRoute("/superadmin"), false);
  assert.equal(isAdminRoute("/superadmin/empresas"), false);
});
