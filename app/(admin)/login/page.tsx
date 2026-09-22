import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { authErrorMessage } from "@/lib/google-auth";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // Los errores del flujo de Google llegan como código en la URL; el formulario
  // solo muestra el mensaje seguro (`lib/google-auth.ts`).
  return <AdminLoginForm googleError={authErrorMessage(error)} />;
}
