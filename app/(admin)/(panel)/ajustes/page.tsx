import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdminContext } from "@/lib/server/tenancy";

export const metadata: Metadata = { title: "Ajustes" };

/**
 * Ajustes (issue #56): la entrada del nav aterriza en la primera sección que el
 * rol puede usar —Empresa para OWNER/ADMIN, Plan para el resto—, así nadie cae
 * en una pantalla restringida. Las secciones tienen su propia URL.
 */
export default async function AjustesPage() {
  const result = await requireAdminContext();
  const canManage = result.ok && (result.context.role === "OWNER" || result.context.role === "ADMIN");
  redirect(canManage ? "/ajustes/empresa" : "/ajustes/plan");
}
