"use client";

import type { AdminIconName } from "@/lib/admin-types";
import { AdminSubtabs } from "../AdminUI";
import { AuditoriaModule } from "./AuditoriaModule";
import { SistemaModule } from "./SistemaModule";

/**
 * Estado (issue #56): el estado del servicio y el historial de cambios, juntos
 * en una sola entrada del nav. Antes eran dos destinos sueltos (`/sistema` y
 * `/auditoria`); las dos secciones son OWNER/ADMIN (el API revalida igual) y las
 * rutas viejas siguen entrando con redirect.
 */

export type AdminEstadoSection = "sistema" | "auditoria";

const SECTIONS: ReadonlyArray<{ key: AdminEstadoSection; href: string; label: string; icon: AdminIconName }> = [
  { key: "sistema", href: "/estado/sistema", label: "Sistema", icon: "database" },
  { key: "auditoria", href: "/estado/auditoria", label: "Auditoría", icon: "audit" },
];

export function EstadoModule({ section }: { section: AdminEstadoSection }) {
  return (
    <>
      <div className="admin-subtabs-bar">
        <AdminSubtabs
          label="Secciones de Estado"
          items={SECTIONS.map((item) => ({
            href: item.href,
            label: item.label,
            icon: item.icon,
            active: item.key === section,
          }))}
        />
      </div>

      {section === "sistema" ? <SistemaModule /> : null}
      {section === "auditoria" ? <AuditoriaModule /> : null}
    </>
  );
}
