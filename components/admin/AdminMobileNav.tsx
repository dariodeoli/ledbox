"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAdminNavItemActive } from "@/lib/admin-policy";
import type { AdminIconName } from "@/lib/admin-types";
import { AdminIcon } from "./AdminIcons";

/**
 * Accesos directos de la barra inferior (mobile ≤720 px): Inicio y las tres etapas
 * de Ventas (Leads → Presupuestos → Eventos). El resto de los módulos vive en el
 * drawer (`#admin-sidebar`), que abre el botón «Más». Presupuestos queda activo
 * también en `/firmas`, que vive dentro de él.
 */
const MOBILE_NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: AdminIconName; also?: readonly string[] }> = [
  { href: "/dashboard", label: "Inicio", icon: "overview" },
  { href: "/leads", label: "Leads", icon: "leads" },
  { href: "/presupuestos", label: "Presupuestos", icon: "budgets", also: ["/firmas"] },
  { href: "/eventos", label: "Eventos", icon: "events" },
];

/**
 * Barra de navegación inferior del panel (solo ≤720 px): cuatro accesos de uso
 * diario + «Más», que abre el drawer existente del shell. El ítem activo queda
 * marcado con `aria-current` y el padding del layout corre el contenido y el
 * footer para que la barra no tape nada. En escritorio no se dibuja.
 */
export function AdminMobileNav({ menuOpen, onOpenMenu }: { menuOpen: boolean; onOpenMenu: (opener: HTMLButtonElement) => void }) {
  const pathname = usePathname();

  return (
    <nav className="admin-bottomnav" aria-label="Navegación rápida del panel">
      {MOBILE_NAV_ITEMS.map((item) => {
        const active = isAdminNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="admin-bottomnav-item"
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
          >
            <AdminIcon name={item.icon} size={18} />
            <span className="admin-bottomnav-label">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="admin-bottomnav-item admin-bottomnav-more"
        onClick={(event) => onOpenMenu(event.currentTarget)}
        aria-label="Más módulos"
        aria-controls="admin-sidebar"
        aria-expanded={menuOpen}
        title="Más módulos"
      >
        <AdminIcon name="menu" size={18} />
        <span className="admin-bottomnav-label">Más</span>
      </button>
    </nav>
  );
}
