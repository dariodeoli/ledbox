import { redirect } from "next/navigation";

/**
 * Ruta vieja del Calendario (issue #56): ahora es una vista dentro de Eventos.
 * El parámetro abre el módulo directamente en esa vista.
 */
export default function CalendarioPage() {
  redirect("/eventos?vista=calendario");
}
