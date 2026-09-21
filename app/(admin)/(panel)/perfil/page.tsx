import type { Metadata } from "next";
import { PerfilModule } from "@/components/admin/modules/PerfilModule";

export const metadata: Metadata = { title: "Mi perfil", robots: { index: false, follow: false } };

/** Mi perfil (issue #22): nombre, contraseña y foto. Lo abre el chip de usuario, cualquier rol. */
export default function PerfilPage() {
  return <PerfilModule />;
}
