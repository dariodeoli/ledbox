import Image from "next/image";
import Link from "next/link";
import { InstagramIcon } from "./InstagramIcon";
import { AppFooter } from "@/components/app-footer";

/**
 * Pie del sitio público (issue #38): misma pieza en la landing y en las fichas
 * de producto, con la versión de la app (issue #37) y enlaces reales a las
 * secciones de la landing.
 */
export function PublicFooter() {
  return (
    <AppFooter variant="company" className="app-footer--public">
      <div className="ft-top">
        <Link href="/" className="logo-link" aria-label="LedBox, volver al inicio">
          <Image className="logo-img" src="/assets/icon-192.png" alt="LedBox" width={192} height={192} />
        </Link>
        <div className="ft-links">
          <Link href="/#productos">Productos</Link>
          <Link href="/#servicios">Servicios</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/#proceso">Proceso</Link>
          <Link href="/#contacto">Contacto</Link>
          <Link href="/privacidad">Privacidad</Link>
          <a href="https://www.instagram.com/ledboxpy/" target="_blank" rel="noopener noreferrer">Instagram</a>
        </div>
      </div>
      <a className="ft-social" href="https://www.instagram.com/ledboxpy/" target="_blank" rel="noopener noreferrer">
        <InstagramIcon />
        <span>Instagram · @ledboxpy</span>
      </a>
      <div className="ft-div" />
      <div className="ft-bottom">
        <span>Tecnología visual que impulsa tu marca</span>
        <span>Asunción, Paraguay · ledbox.online</span>
      </div>
      <div className="ft-bg" aria-hidden="true" />
    </AppFooter>
  );
}
