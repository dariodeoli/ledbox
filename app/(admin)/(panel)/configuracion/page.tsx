import { redirect } from "next/navigation";

/** Ruta vieja de Configuración (issue #56): el correo vive en Ajustes. */
export default function ConfiguracionPage() {
  redirect("/ajustes/correo");
}
