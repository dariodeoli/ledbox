import assert from "node:assert/strict";
import { test } from "node:test";
import { authErrorMessage } from "../lib/google-auth";

/**
 * Errores del SSO (issue #38): la URL solo lleva códigos y cada código se
 * traduce a un mensaje seguro. Un valor desconocido (o texto libre puesto a
 * mano en `?error=`) nunca se refleja: cae en el mensaje genérico.
 */

test("los códigos de Google y de invitación tienen mensaje propio", () => {
  for (const code of ["google_state", "google_not_allowed", "invitation_email_mismatch", "invitation_conflict"]) {
    const message = authErrorMessage(code);
    assert.notEqual(message, "", `${code} tiene que tener mensaje`);
    assert.equal(message.includes(code), false, `${code} no puede aparecer en el mensaje`);
  }
});

test("un código desconocido no se filtra", () => {
  assert.equal(authErrorMessage("google_lo_que_sea"), "No pudimos completar el acceso. Probá de nuevo.");
});

test("texto libre en ?error= no se refleja", () => {
  const injected = "<b>Tu cuenta fue bloqueada, escribinos a un sitio raro</b>";
  assert.equal(authErrorMessage(injected), "No pudimos completar el acceso. Probá de nuevo.");
});

test("sin código no hay mensaje", () => {
  assert.equal(authErrorMessage(""), "");
  assert.equal(authErrorMessage(null), "");
  assert.equal(authErrorMessage(undefined), "");
});
