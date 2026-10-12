import assert from "node:assert/strict";
import { test } from "node:test";
import { emailError, FIELD_MESSAGES } from "../lib/field-rules";
import { invitationFormValidity, userFormValidity } from "../components/admin/modules/usuarios-form-validity";

test("create remains invalid until name, email and twelve-character password are supplied", () => {
  const form = { name: "", email: "", password: "" };
  assert.equal(userFormValidity(form, "create").error, FIELD_MESSAGES.name);
  form.name = "Ana Martínez";
  assert.equal(userFormValidity(form, "create").error, emailError(""));
  form.email = "ana@example.com";
  assert.equal(userFormValidity(form, "create").error, "La contraseña inicial debe tener al menos 12 caracteres.");
  form.password = "12345678901";
  assert.notEqual(userFormValidity(form, "create").error, null);
  form.password += "2";
  assert.equal(userFormValidity(form, "create").error, null);
  form.email = "ana@";
  assert.notEqual(userFormValidity(form, "create").error, null, "becoming invalid must disable submission again");
});

test("name bounds and email rules are the existing shared contract, not browser required alone", () => {
  const form = { name: " ", email: "ana@example.com", password: "123456789012" };
  for (const name of [" ", "A", "A".repeat(121)]) {
    assert.equal(userFormValidity({ ...form, name }, "create").error, FIELD_MESSAGES.name);
  }
  for (const email of ["", "not-an-email", "ana@", "ana example.com"]) {
    assert.equal(userFormValidity({ ...form, name: "Ana", email }, "create").error, emailError(email));
  }
  assert.equal(userFormValidity({ ...form, name: "A".repeat(120) }, "create").error, null);
});

test("edit normalizes account fields, needs no initial password and rejects cleared fields", () => {
  assert.deepEqual(userFormValidity({ name: "  Ana   Martínez ", email: " ANA@EXAMPLE.COM " }, "edit"), {
    name: "Ana Martínez", email: "ana@example.com", error: null,
  });
  assert.equal(userFormValidity({ name: "", email: "ana@example.com" }, "edit").error, FIELD_MESSAGES.name);
  assert.equal(userFormValidity({ name: "Ana", email: "" }, "edit").error, emailError(""));
});

test("invitation changes from blank/malformed to valid and back without retaining stale validity", () => {
  for (const email of ["", " ", "ana@", "not-an-email"]) {
    assert.notEqual(invitationFormValidity(email).error, null);
  }
  assert.deepEqual(invitationFormValidity(" ANA@EXAMPLE.COM "), { email: "ana@example.com", error: null });
  assert.notEqual(invitationFormValidity("").error, null);
});

test("password length uses the API raw value, without an extra trimming rule", () => {
  const form = { name: "Ana", email: "ana@example.com", password: "12345678901 " };
  assert.equal(userFormValidity(form, "create").error, null);
  assert.equal(form.password, "12345678901 ", "validation must not rewrite credentials");
});
