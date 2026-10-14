import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATFORM_OWNER_EMAIL, decidePlatformAccess } from "../lib/platform/access";

const HOST = "app.ledbox.online";
const base = {
  user: { active: true, email: PLATFORM_OWNER_EMAIL, emailVerifiedAt: new Date("2026-10-01T00:00:00Z") as Date | null },
  session: { lockedAt: null as Date | null },
  host: HOST,
  isProd: true,
  adminHost: HOST,
};

test("el correo del dueño es la constante acordada", () => {
  assert.equal(PLATFORM_OWNER_EMAIL, "dariodeoli@gmail.com");
});

test("dueño activo, verificado, sin bloqueo y en el host de la app: entra", () => {
  assert.deepEqual(decidePlatformAccess(base), { ok: true });
});

test("sin usuario o sin sesión: deniega", () => {
  assert.deepEqual(decidePlatformAccess({ ...base, user: null }), { ok: false, reason: "no-user" });
  assert.deepEqual(decidePlatformAccess({ ...base, user: undefined }), { ok: false, reason: "no-user" });
  assert.deepEqual(decidePlatformAccess({ ...base, session: null }), { ok: false, reason: "no-session" });
});

test("cuenta inactiva: deniega", () => {
  assert.deepEqual(decidePlatformAccess({ ...base, user: { ...base.user, active: false } }), { ok: false, reason: "inactive" });
});

test("otro correo, aunque sea OWNER de una empresa: deniega", () => {
  for (const email of ["otra@persona.com", "dariodeoli@gmail.co", "xdariodeoli@gmail.com", "dariodeoli@gmail.com.evil.io", ""]) {
    assert.deepEqual(decidePlatformAccess({ ...base, user: { ...base.user, email } }), { ok: false, reason: "not-owner" }, email);
  }
});

test("el correo se compara normalizado (mayúsculas y espacios)", () => {
  assert.deepEqual(decidePlatformAccess({ ...base, user: { ...base.user, email: "  DarioDeOli@Gmail.com " } }), { ok: true });
});

test("correo sin verificar: deniega", () => {
  assert.deepEqual(decidePlatformAccess({ ...base, user: { ...base.user, emailVerifiedAt: null } }), { ok: false, reason: "email-unverified" });
});

test("sesión bloqueada por PIN: deniega", () => {
  assert.deepEqual(decidePlatformAccess({ ...base, session: { lockedAt: new Date() } }), { ok: false, reason: "locked" });
});

test("en producción solo el host de la app; otros hosts deniegan", () => {
  for (const host of ["clientes.ledbox.online", "demo.ledbox.online", "eventos.ledbox.online", "ledbox.online", "", null, undefined]) {
    assert.deepEqual(decidePlatformAccess({ ...base, host }), { ok: false, reason: "wrong-host" }, String(host));
  }
  assert.deepEqual(decidePlatformAccess({ ...base, host: "APP.ledbox.online" }), { ok: true });
  assert.deepEqual(decidePlatformAccess({ ...base, host: "app.ledbox.online, proxy.internal" }), { ok: true });
});

test("fuera de producción el host no cuenta (localhost)", () => {
  assert.deepEqual(decidePlatformAccess({ ...base, isProd: false, host: "localhost:3000" }), { ok: true });
  // Pero el resto de las reglas siguen valiendo.
  assert.deepEqual(decidePlatformAccess({ ...base, isProd: false, host: "localhost:3000", user: { ...base.user, emailVerifiedAt: null } }), { ok: false, reason: "email-unverified" });
});

test("sin adminHost explícito usa el host de publicConfig.adminUrl", () => {
  const { adminHost: _omit, ...rest } = base;
  void _omit;
  const decision = decidePlatformAccess({ ...rest, host: "app.ledbox.online" });
  assert.deepEqual(decision, { ok: true });
});

test("combinaciones: cualquier condición caída alcanza para negar", () => {
  const flags = [0, 1];
  let allowed = 0;
  for (const a of flags) for (const b of flags) for (const c of flags) for (const d of flags) for (const e of flags) {
    const decision = decidePlatformAccess({
      user: { active: !!a, email: b ? PLATFORM_OWNER_EMAIL : "otra@persona.com", emailVerifiedAt: c ? new Date() : null },
      session: { lockedAt: d ? null : new Date() },
      host: e ? HOST : "clientes.ledbox.online",
      isProd: true,
      adminHost: HOST,
    });
    const expected = a && b && c && d && e;
    assert.equal(decision.ok, !!expected, JSON.stringify({ a, b, c, d, e }));
    if (decision.ok) allowed += 1;
  }
  assert.equal(allowed, 1);
});

test("cambiar el correo invalida los links de reset abiertos y el PIN bloqueado no cuenta como actividad", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const users = readFileSync("app/api/admin/users/route.ts", "utf8");
  assert.match(users, /if \(emailChanged\) await tx\.passwordResetToken\.deleteMany\(\{ where: \{ userId: membership\.adminUserId, usedAt: null \} \}\)/);
  const tenancy = readFileSync("lib/server/tenancy.ts", "utf8");
  assert.match(tenancy, /if \(!auth\.session\.lockedAt\) trackAdminActivity\(/);
});
