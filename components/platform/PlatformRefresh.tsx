"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresca datos de plataforma al regresar a la pestaña; sin canales ni notificaciones externas. */
export function PlatformRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <button type="button" className="admin-btn platform-btn" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Actualizando…" : "Actualizar solicitudes"}</button>;
}
