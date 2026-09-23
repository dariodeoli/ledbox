import { redirect } from "next/navigation";

/** Ruta vieja de Plan (issue #56): ahora vive en Ajustes. */
export default function PlanPage() {
  redirect("/ajustes/plan");
}
