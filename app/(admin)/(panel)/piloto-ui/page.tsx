import type { Metadata } from "next";
import "./owncoding.css";
import { PilotoUiBoard } from "./PilotoUiBoard";

/**
 * Página del piloto OwnCoding UI (22-09-2026).
 *
 * - `noindex`: es una pantalla interna de evaluación, no un módulo del panel.
 * - Sin link en el nav y sin entrada en `lib/admin-routes` (a propósito: en
 *   producción el host público no la redirigiría al subdominio del panel; si el
 *   piloto se convierte en módulo, hay que sumarla ahí).
 * - Importa su propio CSS (Tailwind 3.4 + `owncoding-ui/styles.css`): Next lo
 *   sirve como chunk de esta ruta, así que el resto del panel no lo descarga.
 */
export const metadata: Metadata = {
  title: "Piloto OwnCoding UI",
  robots: { index: false, follow: false },
};

export default function PilotoUiPage() {
  return <PilotoUiBoard />;
}
