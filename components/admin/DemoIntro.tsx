"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminIcon } from "./AdminIcons";
import { AdminDialog } from "./AdminUI";

/**
 * Bienvenida de la demo pública (pedido del 22-09-2026): es un **popup de
 * inicio** con «Recorrer la demo» y la X del diálogo; al cerrarlo no vuelve a
 * mostrarse en ese navegador y la portada se ve normal.
 *
 * La barra fina queda siempre visible: reabre la bienvenida y mantiene a mano
 * los accesos a la autogestión del portal, al resumen y el reinicio de datos.
 * Si se quiere volver a mostrarla a todos, se sube la versión de la clave.
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

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      dismissed = false;
    }
    setOpen(!dismissed);
    setReady(true);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Sin almacenamiento (modo privado estricto): se cierra solo en esta visita.
    }
    setOpen(false);
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
            <span>Ir al resumen</span>
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
            se guardan cambios ni se toca información real.
          </p>
          <p className="admin-dialog-text">
            EventOS es la app; {organizationName} es la empresa de ejemplo que la usa en esta demo (el portal del
            cliente conserva la marca LedBox). Las ferias y marcas que aparecen son referencias reales del mercado
            paraguayo usadas como datos simulados, con contactos inventados; las fechas del calendario se re-anclan a
            hoy cada vez que entrás, y con ellas la mora, los equipos faltantes, los gastos sin proyecto y los
            comprobantes en revisión: la demo muestra también lo que sale mal. La cuenta demo entra como{" "}
            <strong>VIEWER sin PIN ni auto-bloqueo</strong>: no se bloquea sola y los módulos de administración
            (Usuarios, Empresa, Configuración y Auditoría) quedan para OWNER/ADMIN — acá se resumen en la portada.
            Para salir de la demo usá «Salir de la demo» en el aviso superior.
          </p>
          <div className="admin-dialog-actions">
            <button type="button" className="admin-btn admin-btn--primary" onClick={dismiss}>
              <AdminIcon name="check" size={15} />
              <span>Recorrer la demo</span>
            </button>
            {portalActions}
          </div>
        </AdminDialog>
      ) : null}
    </>
  );
}
