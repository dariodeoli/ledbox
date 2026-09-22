import type { Metadata } from "next";
import { PlanModule } from "@/components/admin/modules/PlanModule";

export const metadata: Metadata = { title: "Plan" };

/**
 * Plan de la empresa (issue #42): plan vigente, consumo del mes, comparación del
 * catálogo y solicitud de cambio auditada. Visible para todos los roles; solo
 * OWNER/ADMIN ven la acción de solicitar.
 */
export default function PlanPage() {
  return <PlanModule />;
}
