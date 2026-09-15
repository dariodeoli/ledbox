import { Suspense } from "react";
import { AdminResetForm } from "@/components/admin/AdminResetForm";

function ResetFallback() {
  return <main className="admin-page"><section className="admin-card admin-card--center"><p className="admin-kicker">LedBox · Seguridad</p><p className="admin-loading">Cargando enlace seguro…</p></section></main>;
}

export default function AdminResetPasswordPage() {
  return <Suspense fallback={<ResetFallback />}><AdminResetForm /></Suspense>;
}
