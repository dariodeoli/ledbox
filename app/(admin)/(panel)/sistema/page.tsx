import { redirect } from "next/navigation";

/** Ruta vieja de Sistema (issue #56): ahora vive en Estado. */
export default function SistemaPage() {
  redirect("/estado/sistema");
}
