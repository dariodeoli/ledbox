import assert from "node:assert/strict";
import { test } from "node:test";
import { openPublicMenu } from "../components/public/public-menu-lifecycle";

function fixture(desktop = false) {
  const callbacks = new Set<() => void>();
  const media = { matches: desktop, addEventListener: (_: string, cb: () => void) => callbacks.add(cb), removeEventListener: (_: string, cb: () => void) => callbacks.delete(cb) };
  const doc = { body: { style: { overflow: "auto" } }, documentElement: { style: { overflow: "clip" } }, defaultView: { matchMedia: () => media } };
  let closed = 0, focused = 0, shown = 0;
  const dialog = { ownerDocument: doc, open: false, showModal() { shown++; this.open = true; }, close() { this.open = false; } };
  const trigger = { isConnected: true, focus() { focused++; } };
  const release = openPublicMenu(dialog as unknown as HTMLDialogElement, trigger as unknown as HTMLButtonElement, () => closed++);
  return { doc, dialog, media, callbacks, trigger, release, counts: () => ({ closed, focused, shown }) };
}

test("mobile menu uses native modal scope, locks body and root, restores previous styles and trigger", () => {
  const f = fixture();
  assert.deepEqual(f.counts(), { closed: 0, focused: 0, shown: 1 });
  assert.equal(f.dialog.open, true);
  assert.equal(f.doc.body.style.overflow, "hidden"); assert.equal(f.doc.documentElement.style.overflow, "hidden");
  f.release();
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.body.style.overflow, "auto"); assert.equal(f.doc.documentElement.style.overflow, "clip");
  assert.equal(f.counts().focused, 1); assert.equal(f.callbacks.size, 0);
});
test("native Escape close still restores body and opener during cleanup", () => {
  const f = fixture(); f.dialog.close(); f.release();
  assert.equal(f.doc.body.style.overflow, "auto"); assert.equal(f.counts().focused, 1);
});
test("desktop activation never locks scrolling or opens a modal", () => {
  const f = fixture(true); f.release();
  assert.deepEqual(f.counts(), { closed: 1, focused: 0, shown: 0 });
  assert.equal(f.doc.body.style.overflow, "auto"); assert.equal(f.callbacks.size, 0);
});
test("resizing to desktop closes the mobile menu and releases resources", () => {
  const f = fixture(); f.media.matches = true;
  for (const cb of f.callbacks) cb();
  assert.equal(f.counts().closed, 1); f.trigger.isConnected = false; f.release();
  assert.equal(f.callbacks.size, 0); assert.equal(f.counts().focused, 0);
  assert.equal(f.doc.documentElement.style.overflow, "clip");
});
