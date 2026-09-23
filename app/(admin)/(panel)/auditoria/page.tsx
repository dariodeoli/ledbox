import { redirect } from "next/navigation";

/** Ruta vieja de Auditoría (issue #56): ahora vive en Estado. */
export default function AuditoriaPage() {
  redirect("/estado/auditoria");
}
