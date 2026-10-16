import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error El checker ejecutable es ESM JavaScript, sin declaración adicional.
import { inspectSharedFields } from "../scripts/check-shared-fields.mjs";

test("el guard detecta controles reales y no ejemplos dentro de comentarios o strings", () => {
  const source = `// <input type="text" />
    const example = '<textarea />';
    const view = <div>{/* <select /> */}<input type="date" /><textarea /></div>;`;
  assert.equal(inspectSharedFields("components/new/Example.tsx", source).length, 2);
});

test("ni checkbox ni radio ni select de impresión quedan exceptuados por superficie", () => {
  for (const path of ["app/(portal)/Example.tsx", "app/(admin)/(print)/Example.tsx", "components/catalog-public/Example.tsx"]) {
    assert.equal(inspectSharedFields(path, '<><input type="checkbox" /><input type="radio" /><select /></>').length, 3);
  }
});

test("ocultos y trampas sólo se permiten con atributos estáticos reconocidos", () => {
  const good = '<><input type={"hidden"} name="id" /><input name="website" tabIndex={-1} autoComplete="off" className="cp-trap" /></>';
  assert.deepEqual(inspectSharedFields("components/Example.tsx", good), []);
  const bad = '<><input type="hidden" {...props} /><input name="website" /><input tabIndex={-1} autoComplete="off" className="cp-trap" /><input name="website" tabIndex={0} autoComplete="off" className="cp-trap" /></>';
  assert.equal(inspectSharedFields("components/Example.tsx", bad).length, 4);
});

test("la excepción del kit es exacta; AdminUI sólo puede contener uploaders", () => {
  assert.deepEqual(inspectSharedFields("components/admin/AdminFields.tsx", '<input type="radio" />'), []);
  assert.equal(inspectSharedFields("components/admin/AdminFieldsCopy.tsx", '<input />').length, 1);
  assert.deepEqual(inspectSharedFields("components/admin/AdminUI.tsx", '<input type="file" />'), []);
  assert.equal(inspectSharedFields("components/admin/AdminUI.tsx", '<input type="date" />').length, 1);
});

test("los consumidores compartidos no se consideran implementaciones nativas", () => {
  assert.deepEqual(inspectSharedFields("components/Example.tsx", '<><SharedInput /><RadioControl /><FileField /><SharedSelect /><NumberField /></>'), []);
});
