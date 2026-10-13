"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon } from "./AdminIcons";
import { AdminDialog } from "./AdminUI";

/**
 * Bienvenida de la demo pública. Se abre **sola una única vez** por navegador (la
 * primera visita): al abrirse queda marcada como vista, así reiniciar los datos,
 * recargar o volver no la repiten. Después se abre a pedido: con «Recorrido
 * guiado» de la franja demo (`?recorrido=1`) o con «¿Cómo funciona la demo?».
 * El almacenamiento va con try/catch: sin él la bienvenida se muestra al abrir
 * `/demo`, sin reabrirse sola mientras se navega. Si se quiere volver a mostrarla a todos, se sube la
 * versión de la clave.
 */
const STORAGE_KEY = "ledbox.demo.intro.v1";

export function DemoIntro({
  organizationName,
  pendingUrl,
  approvedUrl,
  resetForm,
}: {
  organizationName: string;
  pendingUrl: string | null;
  approvedUrl: string | null;
  /** Formulario de «Reiniciar los datos» (POST a `/api/demo/session`), armado en la página. */
  resetForm: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const requested = useSearchParams().get("recorrido") === "1";

  /** Marca la bienvenida como vista en este navegador (best-effort). */
  function markSeen() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Sin almacenamiento (modo privado estricto): se muestra una vez por visita.
    }
  }

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      seen = false;
    }
    // Primera visita o pedido explícito. Abrirla ya cuenta como vista.
    if (requested || !seen) {
      setOpen(true);
      markSeen();
    }
    setReady(true);
  }, [requested]);

  function dismiss() {
    markSeen();
    setOpen(false);
    if (requested) router.replace(pathname, { scroll: false });
  }

  /** Cierra la bienvenida y baja al recorrido guiado de la portada (issue #58). */
  function startTour() {
    dismiss();
    window.setTimeout(() => {
      document.getElementById("recorrido")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  const portalActions = (
    <>
      {pendingUrl ? (
        <a
          className="admin-btn admin-btn--primary"
          href={pendingUrl}
          target="_blank"
          rel="noreferrer"
          title="Portal del presupuesto pendiente: proponé cantidades y días o pedí una rebaja"
        >
          <AdminIcon name="external" size={15} />
          <span>Probar la autogestión</span>
        </a>
      ) : null}
      {approvedUrl ? (
        <a
          className="admin-btn"
          href={approvedUrl}
          target="_blank"
          rel="noreferrer"
          title="Portal del presupuesto aprobado: plan de pagos y datos de pago de la empresa"
        >
          <AdminIcon name="external" size={15} />
          <span>Presupuesto aprobado</span>
        </a>
      ) : null}
    </>
  );

  return (
    <>
      <div className="admin-demo-bar">
        <button
          type="button"
          className="admin-btn"
          onClick={() => setOpen(true)}
          title="Ver de nuevo la bienvenida de la demo"
        >
          <AdminIcon name="info" size={15} />
          <span>¿Cómo funciona la demo?</span>
        </button>
        <div className="admin-demo-actions">
          {portalActions}
          <Link className="admin-btn" href="/dashboard">
            <AdminIcon name="overview" size={15} />
            <span>Ir al inicio</span>
          </Link>
          {resetForm}
        </div>
      </div>

      {ready && open ? (
        <AdminDialog title={`Demo de EventOS · ${organizationName}`} size="wide" icon="eye" onClose={dismiss}>
          <p className="admin-dialog-text">
            Estás en la demo pública de <strong>EventOS</strong> con datos simulados de una empresa de ejemplo (
            <strong>{organizationName}</strong>): ferias, clientes, presupuestos, inventario, finanzas, tesorería,
            gastos y conciliación sobre el calendario real de eventos del Paraguay. Son{" "}
            <strong>datos simulados, incluidos los casos difíciles</strong>: mora, cheques rechazados, promotoras no
            disponibles, equipos dañados o faltantes, checklists incompletos, proveedores atrasados, gastos todavía{" "}
            <strong>«A definir»</strong>, comprobantes <strong>por confirmar</strong> y recordatorios que fallan,
            igual que en una semana real de operación. También vas a ver un logo y avatares propios: la empresa de
            ejemplo tiene identidad. La sesión es automática y todo el panel es de <strong>solo lectura</strong>: no
            se guardan cambios ni se toca información real, y lo que simules en el portal del cliente vive solo en tu
            pestaña.
          </p>
          <p className="admin-dialog-text">
            EventOS es la app; {organizationName} es la empresa de ejemplo que la usa en esta demo (el portal del
            cliente conserva la marca LedBox). Las ferias y marcas que aparecen son referencias reales del mercado
            paraguayo usadas como datos simulados, con contactos inventados; las fechas del calendario se re-anclan a
            hoy cada vez que entrás, y con ellas la mora, los equipos faltantes, los gastos sin proyecto y los
            comprobantes en revisión: la demo muestra también lo que sale mal. La cuenta demo entra como{" "}
            <strong>VIEWER sin PIN ni auto-bloqueo</strong>: no se bloquea sola y los módulos de administración
            (Usuarios, Empresa, Correo y Auditoría) quedan para OWNER/ADMIN y no se abren en la demo.
            Para salir de la demo usá «Salir» en la franja superior. Si querés volver al estado inicial,
            «Reiniciar la demo» vuelve a sembrar los datos simulados con las fechas de hoy.
          </p>
          <div className="admin-dialog-actions">
            <button type="button" className="admin-btn admin-btn--primary" onClick={startTour}>
              <AdminIcon name="overview" size={15} />
              <span>Empezar el recorrido</span>
            </button>
            {portalActions}
            {resetForm}
          </div>
        </AdminDialog>
      ) : null}
    </>
  );
}
