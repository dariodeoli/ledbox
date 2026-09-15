import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Panel privado",
  description: "Panel privado de gestión de contactos y cotizaciones de LedBox.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="admin-root">{children}</div>;
}
