import { redirect } from "next/navigation";

/**
 * Ruta vieja de Configuración → Seguridad (issue #56): el PIN y el auto-bloqueo
 * son del usuario y viven en Mi perfil; acá no queda una copia duplicada.
 */
export default function ConfiguracionSeguridadPage() {
  redirect("/perfil");
}
