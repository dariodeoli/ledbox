import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { AdminThemeToggle } from "@/components/admin/admin-theme";
import type { AdminIconName } from "@/lib/admin-types";

/**
 * Shell del panel de plataforma (server). Reutiliza las clases de sidebar del panel pero
 * no `AdminShell`: ese exige contexto de empresa. Sin estado ni datos del usuario: solo
 * navegación. En móvil el menú pasa a una franja horizontal arriba (sin JavaScript).
 */

export type PlatformSection = "resumen" | "actividad" | "trafico" | "empresas" | "usuarios";

type NavItem = { key: PlatformSection; label: string; href: string; icon: AdminIconName; soon?: boolean };

const NAV: NavItem[] = [
  { key: "resumen", label: "Resumen", href: "/superadmin", icon: "overview" },
  { key: "actividad", label: "Actividad", href: "/superadmin/actividad", icon: "clock" },
  { key: "trafico", label: "Tráfico", href: "/superadmin/trafico", icon: "globe" },
  { key: "empresas", label: "Empresas", href: "/superadmin/empresas", icon: "building" },
  { key: "usuarios", label: "Usuarios", href: "/superadmin/usuarios", icon: "users" },
];

export function PlatformShell({
  active,
  title,
  children,
}: Readonly<{ active: PlatformSection; title: string; children: React.ReactNode }>) {
  return (
    <div className="admin-shell platform-shell">
      <a className="admin-skip-link" href="#platform-main">Saltar al contenido</a>
      <aside className="admin-sidebar platform-sidebar" aria-label="Módulos de plataforma">
        <div className="admin-sidebar-head">
          <Link href="/superadmin" className="admin-brand" aria-label="LedBox · Plataforma">
            <BrandMark className="admin-brand-mark" size={30} />
            <span className="admin-brand-text">
              Plataforma<span className="admin-brand-dot">.</span>
            </span>
          </Link>
        </div>
        <div className="admin-sidebar-nav" role="navigation" aria-label="Secciones">
          <div className="admin-nav-group">
            <p className="admin-nav-label">Plataforma</p>
            <ul className="admin-nav-list platform-nav-list">
              {NAV.map((item) => (
                <li key={item.key}>
                  {item.soon ? (
                    <span className="admin-nav-link platform-nav-soon" aria-disabled="true" title="Próximamente">
                      <AdminIcon name={item.icon} size={16} />
                      <span className="admin-nav-text">{item.label}</span>
                      <small className="platform-soon">próximamente</small>
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      className="admin-nav-link"
                      data-active={active === item.key ? "true" : undefined}
                      aria-current={active === item.key ? "page" : undefined}
                    >
                      <AdminIcon name={item.icon} size={16} />
                      <span className="admin-nav-text">{item.label}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="admin-sidebar-foot">
          <p className="admin-sidebar-note">Solo lectura · LedBox</p>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <p className="admin-topbar-eyebrow">Plataforma</p>
            <h1 className="admin-topbar-heading">{title}</h1>
          </div>
          <div className="admin-topbar-tools">
            <AdminThemeToggle />
          </div>
        </header>
        <main id="platform-main" className="admin-main-body platform-main">{children}</main>
      </div>
    </div>
  );
}
