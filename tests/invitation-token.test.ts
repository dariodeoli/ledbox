import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUDGET_CODE_ALPHABET,
  INVITATION_TOKEN_LENGTH,
  invitationAcceptUrl,
  normalizeInvitationToken,
  publicConfig,
  UNAMBIGUOUS_ALPHABET,
} from "../lib/public-config";

/**
 * Token de invitación al equipo (issue #31): misma regla que el código del
 * portal —alfabeto sin caracteres ambiguos y link en el host del panel—, así el
 * token no se enumera ni se confunde al copiarlo de un correo.
 */

test("el alfabeto público no tiene caracteres ambiguos", () => {
  for (const char of ["0", "1", "I", "O"]) {
    assert.equal(UNAMBIGUOUS_ALPHABET.includes(char), false, `el alfabeto no puede incluir ${char}`);
  }
  for (const char of ["2", "9", "A", "Z"]) {
    assert.equal(UNAMBIGUOUS_ALPHABET.includes(char), true, `el alfabeto tiene que incluir ${char}`);
  }
  // El código del portal y el token de invitación usan el mismo alfabeto.
  assert.equal(BUDGET_CODE_ALPHABET, UNAMBIGUOUS_ALPHABET);
});

test("el token de invitación mide 120 bits de alfabeto", () => {
  assert.equal(INVITATION_TOKEN_LENGTH, 24);
  assert.ok(Math.log2(UNAMBIGUOUS_ALPHABET.length) * INVITATION_TOKEN_LENGTH >= 120);
});

test("normalizeInvitationToken acepta el link, el path y el token suelto", () => {
  const token = "2A4B6C8D2E4F6G8H2J4K6M8N";
  assert.equal(normalizeInvitationToken(token), token);
  assert.equal(normalizeInvitationToken(token.toLowerCase()), token);
  assert.equal(normalizeInvitationToken(`https://admin.ledbox.online/invitacion/${token}?x=1`), token);
  assert.equal(normalizeInvitationToken(`/invitacion/${token}`), token);
  assert.equal(normalizeInvitationToken(` ${token} `), token);
});

test("normalizeInvitationToken rechaza tokens con forma inválida", () => {
  // Caracteres ambiguos (0, 1, I, L, O) y largos distintos a 24.
  assert.equal(normalizeInvitationToken("0A4B6C8D2E4F6G8H2J4K6M8N"), null);
  assert.equal(normalizeInvitationToken("IA4B6C8D2E4F6G8H2J4K6M8N"), null);
  assert.equal(normalizeInvitationToken("2A4B6C8D2E4F6G8H2J4K6M8"), null);
  assert.equal(normalizeInvitationToken(""), null);
  assert.equal(normalizeInvitationToken(null), null);
});

test("el link de aceptación vive en el host del panel", () => {
  const url = invitationAcceptUrl("2A4B6C8D2E4F6G8H2J4K6M8N");
  assert.equal(url.startsWith(publicConfig.adminUrl), true);
  assert.equal(url, `${publicConfig.adminUrl}/invitacion/2A4B6C8D2E4F6G8H2J4K6M8N`);
});
