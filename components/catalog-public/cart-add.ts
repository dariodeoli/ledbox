"use client";

import { MAX_QUANTITY } from "@/lib/storefront-ui";
import { readLocalStoreCart, sanitizeStoreCart, storeCartKey, writeLocalStoreCart } from "@/lib/store-cart";

/**
 * Cliente: suma un producto al MISMO carrito de la tienda (navegador y, si el cliente tiene acceso o enlace guardado,
 * también el servidor) desde fuera del catálogo (ficha, «Completá el ambiente»). El precio no se guarda: lo calcula el
 * servidor al abrir el pedido. Avisa al encabezado con el evento `cp:cart-count`.
 */
export type CartScope = "public" | "acceso" | "mayorista";

export function storedCartCount(slug: string, scope: CartScope): number {
  return readLocalStoreCart(storeCartKey(slug, scope)).items.reduce((sum, line) => sum + line.quantity, 0);
}

export async function addToStoredCart(options: { slug: string; scope: CartScope; cartPath: string | null; itemId: string; quantity: number }): Promise<{ ok: true; count: number; warning: string | null } | { ok: false; error: string }> {
  const { slug, scope, cartPath, itemId, quantity } = options;
  const key = storeCartKey(slug, scope);
  const current = readLocalStoreCart(key);
  const existing = current.items.find((line) => line.id === itemId);
  const items = existing
    ? current.items.map((line) => (line.id === itemId ? { ...line, quantity: Math.min(MAX_QUANTITY, line.quantity + quantity) } : line))
    : [...current.items, { id: itemId, quantity: Math.min(MAX_QUANTITY, quantity) }];
  const next = sanitizeStoreCart({ ...current, items });
  const stored = writeLocalStoreCart(key, next);
  let path = cartPath;
  if (!path && scope === "public") {
    try {
      const token = window.localStorage.getItem(`ledbox-store-visitor:${slug.trim().toLowerCase()}`);
      if (token) path = `/api/catalog/${encodeURIComponent(slug)}/carrito/${token}/cart`;
    } catch {
      /* sin almacenamiento */
    }
  }
  const count = next.items.reduce((sum, line) => sum + line.quantity, 0);
  let warning: string | null = null;
  if (path) {
    try {
      const response = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (failure) {
      console.error("tienda: no se pudo guardar el carrito en el servidor", failure);
      warning = "Lo agregamos en este dispositivo, pero no pudimos guardarlo en tu carrito guardado.";
    }
  } else if (!stored) {
    return { ok: false, error: "Tu navegador no permite guardar el carrito: agregalo desde el catálogo." };
  }
  (window as unknown as { __cpCartCount?: number }).__cpCartCount = count;
  window.dispatchEvent(new CustomEvent("cp:cart-count", { detail: count, bubbles: false }));
  return { ok: true, count, warning };
}
