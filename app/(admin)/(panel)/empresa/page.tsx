import { redirect } from "next/navigation";

/** Ruta vieja de Empresa (issue #56): ahora vive en Ajustes. */
export default function EmpresaPage() {
  redirect("/ajustes/empresa");
}
