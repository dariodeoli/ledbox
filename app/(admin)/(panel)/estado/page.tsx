import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Estado" };

/** Estado (issue #56): Sistema y Auditoría en una sola área; la entrada va a Sistema. */
export default function EstadoPage() {
  redirect("/estado/sistema");
}
