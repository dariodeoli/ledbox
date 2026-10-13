import Link from "next/link";
import { DEMO_TOUR_STEPS } from "@/lib/demo-tour";
import { AdminIcon } from "./AdminIcons";
import { AdminPanel } from "./AdminUI";

/**
 * Recorrido guiado de la demo (issue #58), como lista compacta: cinco pasos
 * numerados, cada uno un link al módulo con una línea de qué mirar. Sin estado
 * ni almacenamiento: es una lista, no un asistente (13-10-2026).
 */
export function DemoTour() {
  return (
    <div id="recorrido">
      <AdminPanel title="Recorrido guiado" icon="overview" meta={`${DEMO_TOUR_STEPS.length} pasos`}>
        <ol className="admin-demo-cases-list" aria-label="Recorrido guiado de la demo">
          {DEMO_TOUR_STEPS.map((step, index) => (
            <li key={step.id}>
              <Link className="admin-demo-case-row" href={step.href}>
                <span className="admin-demo-case-count">{index + 1}</span>
                <span className="admin-demo-case-text">
                  <strong>{step.title}</strong>
                  <small>{step.what}</small>
                </span>
                <AdminIcon name="arrow-right" size={14} />
              </Link>
            </li>
          ))}
        </ol>
      </AdminPanel>
    </div>
  );
}
