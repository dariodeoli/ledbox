import { redirect } from "next/navigation";

/** Ruta vieja de Usuarios (issue #56): ahora vive en Ajustes. */
export default function UsuariosPage() {
  redirect("/ajustes/usuarios");
}
