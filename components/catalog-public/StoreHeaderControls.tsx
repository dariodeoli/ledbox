"use client";

import { useEffect, useRef, useState } from "react";
import type { StoreNavLink } from "./StoreHeader";
import { storedCartCount, type CartScope } from "./cart-add";

/**
 * Parte interactiva del encabezado: navegación (escritorio), búsqueda, píldora «Pedido (N)» con contador animado, menú
 * compacto (móvil, con Esc y clic afuera) y el estado «compacto» al hacer scroll. El contador y la apertura del pedido
 * hablan con el catálogo por eventos del navegador (`cp:cart-count`, `cp:open-cart`); en la ficha el contador sale del
 * carrito guardado y el botón lleva al catálogo.
 */
export function StoreHeaderControls({ nav, cart, slug, cartScope, searchHref }: { nav: StoreNavLink[]; cart: "button" | { href: string } | null; slug: string; cartScope: CartScope; searchHref: string | null }) {
  const [count, setCount] = useState(0);
  const [bump, setBump] = useState(false);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const previous = useRef(0);

  useEffect(() => {
    const initial = (window as unknown as { __cpCartCount?: number }).__cpCartCount;
    if (typeof initial === "number") setCount(initial);
    else if (cart !== "button") {
      try { setCount(storedCartCount(slug, cartScope)); } catch { /* sin almacenamiento */ }
    }
    const onCount = (event: Event) => setCount(Number((event as CustomEvent<number>).detail) || 0);
    window.addEventListener("cp:cart-count", onCount);
    return () => window.removeEventListener("cp:cart-count", onCount);
  }, [cart, slug, cartScope]);

  // Al subir el contador se anima un instante (respeta «reducir movimiento» desde el CSS).
  useEffect(() => {
    if (count > previous.current) {
      setBump(true);
      const timer = setTimeout(() => setBump(false), 300);
      previous.current = count;
      return () => clearTimeout(timer);
    }
    previous.current = count;
  }, [count]);

  // Encabezado sticky que se compacta al hacer scroll.
  useEffect(() => {
    const header = wrap.current?.closest("header");
    if (!header) return;
    const onScroll = () => header.setAttribute("data-compact", window.scrollY > 24 ? "true" : "false");
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(false); toggle.current?.focus(); } };
    const onDown = (event: MouseEvent) => { if (wrap.current && !wrap.current.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [menu]);

  const label = count > 0 ? `Ver tu pedido: ${count} ${count === 1 ? "unidad" : "unidades"}` : "Tu pedido: todavía no elegiste productos";
  const bag = (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
  const pill = (
    <>
      {bag}
      <span className="cp-hd-cart-label">Pedido</span>
      <span className="cp-hd-count" data-bump={bump} aria-hidden="true">{count > 0 ? `(${count > 99 ? "99+" : count})` : ""}</span>
    </>
  );

  return (
    <div className="cp-hd-controls" ref={wrap}>
      <nav className="cp-hd-nav" aria-label="Secciones de la tienda">
        {nav.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}
      </nav>
      <div className="cp-hd-actions">
        {searchHref ? (
          <a className="cp-hd-search" href={searchHref} aria-label="Buscar en el catálogo">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
          </a>
        ) : null}
        {cart === "button" ? (
          <button type="button" className="cp-hd-cart" aria-label={label} onClick={() => { setMenu(false); window.dispatchEvent(new Event("cp:open-cart")); }}>{pill}</button>
        ) : cart ? (
          <a className="cp-hd-cart" href={cart.href} aria-label={label}>{pill}</a>
        ) : null}
        {nav.length > 0 ? (
          <button ref={toggle} type="button" className="cp-hd-burger" aria-expanded={menu} aria-controls="cp-hd-menu" aria-label={menu ? "Cerrar menú" : "Abrir menú"} onClick={() => setMenu((value) => !value)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
              {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        ) : null}
      </div>
      {menu ? (
        <div id="cp-hd-menu" className="cp-hd-menu" role="menu">
          {nav.map((link) => <a key={link.label} href={link.href} role="menuitem" onClick={() => setMenu(false)}>{link.label}</a>)}
        </div>
      ) : null}
    </div>
  );
}
