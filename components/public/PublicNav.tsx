"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { whatsappUrl } from "@/lib/public-config";

/**
 * Navegación del sitio público: una sola pieza para la landing y las fichas de
 * producto. Los enlaces apuntan a las secciones de la landing con path absoluto
 * (`/#productos`) para que funcionen también desde `/productos/<slug>`.
 */
export function PublicNav() {
  const [scrolled, setScrolled] = useState(false);

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
        <Link href="/#productos">Productos</Link>
        <Link href="/#servicios">Servicios</Link>
        <Link href="/#marcas">Marcas</Link>
        <Link href="/#proceso">Proceso</Link>
        <Link href="/#contacto">Contacto</Link>
      </div>
      <a
        href={whatsappUrl("Hola LedBox! Quiero consultar disponibilidad.")}
        target="_blank"
        rel="noopener noreferrer"
        className="nav-cta"
      >
        Consultar →
      </a>
    </nav>
  );
}
