import Link from "next/link";
import { AppFooter } from "@/components/app-footer";
import { BrandMark } from "@/components/brand-mark";
import { AdminThemeToggle } from "./admin-theme";

/** Marco de las pantallas de acceso (login, recuperación y reset): marca + tema. */
export function AdminFrame({ children, eyebrow = "LedBox · Panel privado" }: { children: React.ReactNode; eyebrow?: string }) {
  return (
    <main className="admin-page">
      <div className="admin-grid" aria-hidden="true" />
      <div className="admin-brandbar">
        <Link href="/" className="admin-brand" aria-label="EventOS · Panel privado">
          <BrandMark className="admin-brand-mark" size={30} />
          <span>
            EventOS<span className="admin-brand-dot">.</span>
          </span>
        </Link>
        <div className="admin-brand-tools">
          <span className="admin-brand-note">Owncoding · private workspace</span>
          <AdminThemeToggle />
        </div>
      </div>
      <div className="admin-content">
        <p className="admin-kicker">{eyebrow}</p>
        {children}
      </div>
      <AppFooter variant="app" className="app-footer--access" />
    </main>
  );
}
