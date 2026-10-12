import assert from "node:assert/strict";
import { test } from "node:test";
import { mountCartDialogFocus } from "../components/cart/cart-dialog-focus";

// Un doble estructural de DOM permite probar el lifecycle sin iniciar browser.
function fixture() {
  const listeners = new Map<string, Set<EventListener>>();
  const doc = {
    activeElement: null as unknown,
    addEventListener(type: string, callback: EventListener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(callback); },
    removeEventListener(type: string, callback: EventListener) { listeners.get(type)?.delete(callback); },
  };
  function element() {
    return { tabIndex: 0, disabled: false, inert: false, visible: true, isConnected: true,
      matches() { return this.disabled; }, closest() { return this.inert ? {} : null; },
      getClientRects() { return this.visible ? [{}] : []; }, focus() { doc.activeElement = this; } };
  }
  const first = element(), last = element(), opener = element();
  let items = [first, last];
  const panel = { ...element(), ownerDocument: doc, querySelectorAll: () => items, contains: (node: unknown) => node === panel || items.includes(node as typeof first) };
  const release = mountCartDialogFocus(panel as unknown as HTMLElement, opener as unknown as HTMLElement);
  function key(shiftKey = false, key = "Tab") {
    let prevented = false;
    const event = { key, shiftKey, preventDefault() { prevented = true; } };
    for (const callback of listeners.get("keydown") ?? []) callback(event as unknown as Event);
    return prevented;
  }
  return { doc, first, last, opener, panel, release, listeners, key, setItems: (value: typeof items) => { items = value; } };
}

test("Tab/ShiftTab wrap at both boundaries, not within the dialog", () => {
  const f = fixture();
  assert.equal(f.doc.activeElement, f.first);
  assert.equal(f.key(), false);
  assert.equal(f.key(true), true); assert.equal(f.doc.activeElement, f.last);
  assert.equal(f.key(), true); assert.equal(f.doc.activeElement, f.first);
  assert.equal(f.key(false, "ArrowRight"), false);
  f.release();
});
test("external focus is recovered and Tab from outside reenters", () => {
  const f = fixture(); f.doc.activeElement = f.opener;
  for (const callback of f.listeners.get("focusin") ?? []) callback({} as Event);
  assert.equal(f.doc.activeElement, f.first);
  f.doc.activeElement = f.opener; assert.equal(f.key(true), true); assert.equal(f.doc.activeElement, f.last);
  f.release();
});
test("dynamic removal, disabled, hidden, inert and negative tabindex controls are excluded", () => {
  const f = fixture();
  f.last.disabled = true; assert.equal(f.key(), true); assert.equal(f.doc.activeElement, f.first);
  f.last.disabled = false; f.last.visible = false; assert.equal(f.key(true), true); assert.equal(f.doc.activeElement, f.first);
  f.last.visible = true; f.last.inert = true; assert.equal(f.key(), true); assert.equal(f.doc.activeElement, f.first);
  f.last.inert = false; f.last.tabIndex = -1; assert.equal(f.key(), true); assert.equal(f.doc.activeElement, f.first);
  f.setItems([]); assert.equal(f.key(), true); assert.equal(f.doc.activeElement, f.panel);
  f.release();
});
test("close lifecycle restores opener and removes containment listeners", () => {
  const f = fixture(); f.release();
  assert.equal(f.doc.activeElement, f.opener);
  assert.equal(f.listeners.get("keydown")!.size, 0);
  assert.equal(f.listeners.get("focusin")!.size, 0);
});
test("disconnected opener is not focused during cleanup", () => {
  const f = fixture(); f.opener.isConnected = false; f.release();
  assert.equal(f.doc.activeElement, f.first);
});
