import type { Metadata } from "next";
import { PortalCodeForm } from "../_components/PortalCodeForm";

export const metadata: Metadata = { title: "Presupuestos", description: "Ingresá el código de tu presupuesto para verlo y aprobarlo." };

/**
 * Landing del portal (issue #12). En el host del cliente (`NEXT_PUBLIC_CLIENT_URL`)
 * el middleware reescribe `/` acá; en el resto de los hosts se llega por `/portal`.
 *
 * Suma la entrada al presupuesto de ejemplo (issue #29): `?demo=unavailable`
 * llega desde `GET /api/portal/demo` cuando la demo no se pudo preparar y la
 * portada lo avisa en vez de fallar.
 */
export default async function PortalHomePage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const params = await searchParams;
  const demoUnavailable = params.demo === "unavailable";

  return (
    <section className="portal-hero">
      <p className="portal-kicker">Presupuestos</p>
      <h1 className="portal-title">
        Mirá y aprobá tu presupuesto<span aria-hidden="true">.</span>
      </h1>
      <p className="portal-lead">
        Ingresá el código que te enviamos para ver el detalle, los montos y las condiciones. Si todo está en orden, podés
        aprobarlo en el momento; si necesitás ajustes, pedinos cambios con un comentario.
      </p>
      <PortalCodeForm demoUnavailable={demoUnavailable} />
    </section>
  );
}
