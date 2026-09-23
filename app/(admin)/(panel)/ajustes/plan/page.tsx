import type { Metadata } from "next";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Plan" };

/**
 * Plan de la empresa (issue #42): plan vigente, consumo del mes, comparación del
 * catálogo y solicitud de cambio auditada. Visible para todos los roles; solo
 * OWNER/ADMIN ven la acción de solicitar.
 */
export default function AjustesPlanPage() {
  return <AjustesModule section="plan" />;
}
