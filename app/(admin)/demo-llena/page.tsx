import type { Metadata } from "next";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { AdminButtonLink } from "@/components/admin/AdminUI";
import { publicConfig } from "@/lib/public-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Demo de EventOS · volvé en unos minutos" },
  robots: { index: false, follow: false },
};

type Motivo = "llena" | "error";

const COPY: Record<Motivo, { title: string; accent: string; text: string; retry: string }> = {
  llena: {
    title: "La demo está llena,",
    accent: "volvé en unos minutos.",
    text: "Hay muchas personas probando EventOS en este momento. Cada demo se libera sola cuando alguien la deja de usar, así que en un rato va a haber lugar.",
    retry: "Probar de nuevo",
  },
  error: {
    title: "No pudimos preparar tu demo,",
    accent: "probá de nuevo.",
    text: "Algo falló al armar tu espacio de prueba. No se perdió nada: volvé a intentarlo en unos segundos.",
    retry: "Probar de nuevo",
  },
};

/**
 * Pantalla sin acceso (docs/DEMO-INTERACTIVA.md §1): la demo no tiene lugar o no se pudo preparar.
 * No crea sesión ni cookie; el link lleva a la landing de EventOS.
 */
export default async function DemoLlenaPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const copy = COPY[motivo === "error" ? "error" : "llena"];
  return (
    <AdminFrame eyebrow="EventOS · Demo">
      <section className="admin-card admin-card--narrow" aria-labelledby="demo-llena-title">
        <h1 id="demo-llena-title" className="admin-title">
          {copy.title}
          <br />
          <span>{copy.accent}</span>
        </h1>
        <p className="admin-lede">{copy.text}</p>
        <AdminButtonLink variant="primary" className="admin-submit" href="/">{copy.retry}</AdminButtonLink>
        <a className="admin-back-link" href={publicConfig.productUrl}>
          ← Conocer EventOS
        </a>
      </section>
    </AdminFrame>
  );
}
