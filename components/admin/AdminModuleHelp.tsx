"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ADMIN_ROOT_ID } from "@/lib/admin-theme";
import { moduleHelpFor } from "@/lib/module-help";
import { AdminIcon } from "./AdminIcons";
import { AdminButton, AdminDialog } from "./AdminUI";

/**
 * Ayuda contextual del módulo («¿Qué es esto?»): botón de interrogación junto al
 * título del topbar que abre la ayuda de la ruta (`lib/module-help.ts`) en el
 * diálogo único del panel.
 *
 * - Se dibuja sola en todos los módulos con ayuda; en una ruta sin entrada
 *   (por ejemplo `/demo`) no monta nada.
 * - Accesible: `aria-label` con el módulo, foco al abrir y cierre con Escape o
 *   clic afuera (los pone `AdminDialog`).
 * - Los links internos cierran el diálogo al navegar y viven al pie del
 *   contenido, así no compiten con las acciones del topbar.
 * - El diálogo se monta con `createPortal` en la raíz del panel: el topbar tiene
 *   `backdrop-filter` y eso lo convertiría en el bloque contenedor de un
 *   `position: fixed`, dejando el diálogo recortado contra la barra.
 */
export function AdminModuleHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const help = moduleHelpFor(pathname);
  if (!help) return null;

  const title = `¿Qué es esto? · ${help.title}`;

  return (
    <>
      <button
        type="button"
        className="admin-iconbtn admin-help-btn"
        onClick={() => setOpen(true)}
        aria-label={title}
        aria-haspopup="dialog"
        title={title}
      >
        <span className="admin-help-mark" aria-hidden="true">
          ?
        </span>
      </button>

      {open
        ? createPortal(
            <AdminDialog title={title} onClose={() => setOpen(false)}>
              <p className="admin-dialog-text">{help.summary}</p>
              <ul className="admin-help-list">
                {help.bullets.map((bullet) => (
                  <li className="admin-help-item" key={bullet}>
                    <AdminIcon name="check" size={13} />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <nav className="admin-help-links" aria-label={`Ir a otro módulo desde ${help.title}`}>
                {help.links.map((link) => (
                  <Link className="admin-help-link" href={link.href} key={link.href} onClick={() => setOpen(false)}>
                    <span>{link.label}</span>
                    <AdminIcon name="arrow-right" size={14} />
                  </Link>
                ))}
              </nav>
              <div className="admin-dialog-foot">
                <span className="admin-dialog-spacer" />
                <AdminButton onClick={() => setOpen(false)}>Cerrar</AdminButton>
              </div>
            </AdminDialog>,
            document.getElementById(ADMIN_ROOT_ID) ?? document.body,
          )
        : null}
    </>
  );
}
