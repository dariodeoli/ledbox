"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { whatsappUrl } from "@/lib/public-config";
import { openPublicMenu } from "./public-menu-lifecycle";

const sections = [
  ["productos", "Productos"], ["servicios", "Servicios"], ["marcas", "Marcas"],
  ["proceso", "Proceso"], ["contacto", "Contacto"],
] as const;

/**
 * Navegación del sitio público: una sola pieza para la landing y las fichas de
 * producto. Los enlaces apuntan a las secciones de la landing con path absoluto
 * (`/#productos`) para que funcionen también desde `/productos/<slug>`.
 */
export function PublicNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    return openPublicMenu(menuRef.current, triggerRef.current, () => setMenuOpen(false));
  }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={scrolled ? "scrolled" : ""} aria-label="Navegación principal">
      <Link href="/" className="logo-link" aria-label="LedBox, volver al inicio">
        <Image className="logo-img" src="/assets/icon-192.png" alt="LedBox" width={192} height={192} priority />
      </Link>
      <div className="nav-center">
        {sections.map(([id, label]) => <Link key={id} href={`/#${id}`}>{label}</Link>)}
      </div>
      <a
        href={whatsappUrl("Hola LedBox! Quiero consultar disponibilidad.")}
        target="_blank"
        rel="noopener noreferrer"
        className="nav-cta"
      >
        Consultar →
      </a>
      <button ref={triggerRef} type="button" className="public-menu-trigger" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(true)}>Menú</button>
      <dialog ref={menuRef} id="public-mobile-menu" className="public-mobile-menu" aria-labelledby="public-menu-title" onClose={event => { if (!event.currentTarget.open) setMenuOpen(false); }} onCancel={() => setMenuOpen(false)} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setMenuOpen(false);
      }}>
        <div className="public-menu-head"><strong id="public-menu-title">Navegación</strong><button type="button" autoFocus aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}>×</button></div>
        <div className="public-menu-links">{sections.map(([id, label]) => <Link key={id} href={`/#${id}`} onClick={() => setMenuOpen(false)}>{label}</Link>)}</div>
      </dialog>
    </nav>
  );
}
