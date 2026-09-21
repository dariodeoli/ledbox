import Link from "next/link";
import { publicConfig } from "@/lib/public-config";

/** 404 del portal (issue #12): código inválido, revocado o presupuesto inexistente. */
export default function PortalNotFound() {
  return (
    <section className="portal-hero" aria-labelledby="portal-404">
      <p className="portal-kicker">Presupuesto</p>
      <h1 className="portal-title" id="portal-404">
        No encontramos ese presupuesto<span aria-hidden="true">.</span>
      </h1>
      <p className="portal-lead">
        El código puede estar mal escrito, o el link fue revocado por el equipo de LedBox. Revisá el código del QR o
        pedí un link nuevo por WhatsApp al {publicConfig.whatsappNumber.replace(/^(\d{3})(\d+)/, "+$1 $2")}.
      </p>
      <Link className="portal-btn portal-btn--primary" href="/portal">
        Probar con otro código
      </Link>
    </section>
  );
}
