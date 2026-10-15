"use client";

import { useState } from "react";
import { readLocalStoreCart, sanitizeStoreCart, storeCartKey, writeLocalStoreCart } from "@/lib/store-cart";

/**
 * «Agregar al pedido» de la ficha: suma al MISMO carrito de la tienda (navegador y, si el cliente tiene acceso o
 * enlace guardado, también el servidor), así al volver al catálogo el producto ya está. El precio no se guarda:
 * lo calcula el servidor al abrir el carrito.
 */
export function ProductAdd({ itemId, name, slug, scope, cartPath, backHref }: { itemId: string; name: string; slug: string; scope: "public" | "acceso" | "mayorista"; cartPath: string | null; backHref: string }) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState("");

  async function add() {
    setError("");
    const key = storeCartKey(slug, scope);
    const current = readLocalStoreCart(key);
    const existing = current.items.find((line) => line.id === itemId);
    const items = existing
      ? current.items.map((line) => (line.id === itemId ? { ...line, quantity: Math.min(99, line.quantity + quantity) } : line))
      : [...current.items, { id: itemId, quantity }];
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
    if (path) {
      try {
        const response = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (failure) {
        console.error("tienda: no se pudo guardar el carrito en el servidor", failure);
        setError("Lo agregamos en este dispositivo, pero no pudimos guardarlo en tu carrito guardado.");
      }
    } else if (!stored) {
      setError("Tu navegador no permite guardar el carrito: agregalo desde el catálogo.");
      return;
    }
    setAdded((count) => count + quantity);
  }

  return (
    <div className="cp-add" data-testid="product-add">
      <div className="cp-qty" role="group" aria-label={`Cantidad de ${name}`}>
        <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Quitar una unidad">−</button>
        <output aria-live="polite">{quantity}</output>
        <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="Agregar una unidad">+</button>
      </div>
      <button type="button" className="cp-btn cp-btn--primary" onClick={() => void add()}>Agregar al pedido</button>
      {added > 0 ? (
        <p className="cp-hint" role="status">Agregaste {added} {added === 1 ? "unidad" : "unidades"}. <a className="cp-link" href={`${backHref}#catalogo`}>Ver mi pedido en el catálogo</a></p>
      ) : null}
      {error ? <p className="cp-error" role="alert">{error}</p> : null}
    </div>
  );
}
