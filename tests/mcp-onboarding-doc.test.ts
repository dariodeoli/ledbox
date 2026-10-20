import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const doc = readFileSync(new URL("../docs/INTEGRACIONES-MCP.md", import.meta.url), "utf8");

test("MCP onboarding distinguishes proposal from available integration and defines core OAuth safeguards", () => {
  assert.match(doc, /authorization server OAuth/);
  assert.match(doc, /Google OAuth sigue siendo únicamente el inicio de sesión web/);
  assert.match(doc, /Authorization Code y PKCE S256/);
  assert.match(doc, /oauth-protected-resource/);
  assert.match(doc, /resource tanto a authorize como a token/);
  assert.match(doc, /valida.*audiencia|valida que aud/i);
  assert.match(doc, /HTTPS válido/);
});

test("MCP onboarding documents tenant, role, confirmation, photo and bounded-result safeguards", () => {
  assert.match(doc, /Nunca confiar en organizationId/);
  assert.match(doc, /lib\/server\/permissions\.ts/);
  assert.match(doc, /idempotency key/);
  assert.match(doc, /confirmación humana/);
  assert.match(doc, /Fotos y límites propuestos/);
  assert.match(doc, /máximo 100 por llamada/);
  assert.match(doc, /no clonar base real/);
});
