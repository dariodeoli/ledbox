import assert from "node:assert/strict";
import test from "node:test";
import { products } from "../lib/catalog";
import { addCartProduct, restoreCart, serializeCart } from "../lib/public-cart";

test("pedido restaura catálogo real y conserva cantidad/días sin persistir datos personales ni precios", () => {
  const item = { product: { ...products[0], price: 1 }, quantity: 2, duration: 3, lead: { email: "private@example.com" } };
  const stored = serializeCart([item]);
  assert.deepEqual(JSON.parse(stored), [{ productId: products[0].id, quantity: 2, duration: 3 }]);
  assert.deepEqual(restoreCart(stored), [{ product: products[0], quantity: 2, duration: 3 }]);
});

test("pedido corrupto, productos desconocidos y cantidades inválidas no contaminan el catálogo", () => {
  for (const value of [null, "{", "null", "{}", '[{"productId":"unknown","quantity":1,"duration":1}]']) assert.deepEqual(restoreCart(value), []);
  const row = { productId: products[0].id, quantity: 2, duration: 3 };
  const invalid = [0, -1, 100, 1.5, "2", null];
  for (const quantity of invalid) assert.deepEqual(restoreCart(JSON.stringify([{ ...row, quantity }])), []);
  assert.deepEqual(restoreCart(JSON.stringify([{ ...row, duration: 91 }])), []);
  assert.equal(restoreCart(JSON.stringify([row, row])).length, 1);
});

test("agregar otra ficha preserva días del pedido y acumula producto sin duplicarlo", () => {
  let cart = [{ product: products[0], quantity: 2, duration: 3 }];
  cart = addCartProduct(cart, products[1]);
  cart = addCartProduct(cart, products[0]);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].quantity, 3);
  assert.equal(cart[0].duration, 3);
  assert.equal(addCartProduct([{ ...cart[0], quantity: 99 }], products[0])[0].quantity, 99);
});
