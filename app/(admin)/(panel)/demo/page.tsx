import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { AdminBadge, AdminEmpty, AdminKpi, AdminPanel } from "@/components/admin/AdminUI";
import {
  auditActionLabel,
  auditActionTone,
  auditDetailText,
  auditEntityLabel,
  formatCalendarDayShort,
  formatDate,
  formatNumber,
} from "@/lib/admin-format";
import { adminNavGroups } from "@/lib/admin-policy";
import type { AdminAuditDetail } from "@/lib/admin-types";
import { portalBudgetUrl, publicConfig } from "@/lib/public-config";
import { qrSvg } from "@/lib/qr";
import { getAuthenticatedAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { DEMO_ORGANIZATION_NAME, isDemoOrganizationId } from "@/lib/server/demo-data";
import { dayKeyOf, listAdminNotifications } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demo",
  description: "Demo pública de LedBox con datos simulados y sin registro.",
  robots: { index: false, follow: false },
};

/**
 * Entrada a la demo pública (issue #14).
 *
 * Sin sesión redirige al endpoint que la provisiona (`GET /api/demo/session`) y
 * vuelve acá; con la sesión demo renderiza el índice de la demo con datos
 * simulados reales: avisos operativos, auditoría, próximos eventos y accesos a
 * cada módulo. Si la sesión abierta es de una cuenta real no se reemplaza sin
 * aviso: se pide confirmación.
 *
 * Todo se lee de la organización demo (`activeOrganizationId` de la sesión), así
 * que nada de otras empresas entra en esta pantalla.
 */
export default async function DemoPage() {
  const auth = await getAuthenticatedAdmin();
  if (!auth) redirect("/api/demo/session?next=/demo");

  if (!(await isDemoOrganizationId(auth.session.activeOrganizationId))) {
    return <DemoInvite userName={auth.user.name} />;
  }
  const organizationId = auth.session.activeOrganizationId as string;
  const now = new Date();

  const [
    clientCount,
    eventCount,
    budgetCount,
    supplierCount,
    inventoryCount,
    promoterCount,
    newLeadCount,
    openJobCount,
    upcomingEvents,
    feed,
    audits,
    portalBudget,
    openBudget,
  ] = await Promise.all([
    db.client.count({ where: { organizationId, active: true } }),
    db.event.count({ where: { organizationId, status: { not: "CANCELLED" } } }),
    db.budget.count({ where: { organizationId, status: { notIn: ["LOST", "CANCELLED"] } } }),
    db.supplier.count({ where: { organizationId, active: true } }),
    db.inventoryItem.count({ where: { organizationId, status: { not: "RETIRED" } } }),
    db.promoter.count({ where: { organizationId, active: true } }),
    db.lead.count({ where: { organizationId, status: "NEW" } }),
    db.supplierJob.count({ where: { organizationId, status: { notIn: ["PAID", "CANCELLED"] } } }),
    db.event.findMany({
      where: { organizationId, startsAt: { gte: now }, status: { not: "CANCELLED" } },
      orderBy: { startsAt: "asc" },
      take: 3,
      include: { client: { select: { name: true, company: true } } },
    }),
    listAdminNotifications(organizationId, now),
    db.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    db.budget.findFirst({
      where: { organizationId, approvedAt: { not: null }, publicToken: { not: null } },
      orderBy: { approvedAt: "desc" },
      select: { id: true, title: true, publicToken: true, approvedAt: true, approvedByName: true, advanceAmount: true, installmentsJson: true },
    }),
    // Presupuesto abierto para recorrer la autogestión: link/QR activos y sin
    // aprobación ni cambios pedidos todavía.
    db.budget.findFirst({
      where: {
        organizationId,
        publicToken: { not: null },
        approvedAt: null,
        revisionRequestedAt: null,
        status: { in: ["SENT", "NEGOTIATING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, publicToken: true, status: true, client: { select: { company: true, name: true } } },
    }),
  ]);

  const modules = adminNavGroups("VIEWER").flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  const approvedUrl = portalBudget?.publicToken ? portalBudgetUrl(portalBudget.publicToken) : null;
  const pendingUrl = openBudget?.publicToken ? portalBudgetUrl(openBudget.publicToken) : null;
  const [approvedQr, pendingQr] = await Promise.all([
    approvedUrl ? qrSvg(approvedUrl, 168) : Promise.resolve(null),
    pendingUrl ? qrSvg(pendingUrl, 168) : Promise.resolve(null),
  ]);
  const approvedInstallments = Array.isArray(portalBudget?.installmentsJson) ? portalBudget.installmentsJson.length : 0;

  return (
    <div className="admin-module-page admin-demo-page">
      <section className="admin-demo-hero">
        <span className="admin-demo-badge">DEMO</span>
        <h2 className="admin-demo-title">
          {DEMO_ORGANIZATION_NAME} <span>·</span> panel completo con datos simulados
        </h2>
        <p className="admin-demo-lede">
          Estás en una copia de trabajo del panel, con ferias, clientes, presupuestos, inventario y finanzas simulados
          sobre el calendario real de eventos del Paraguay. La sesión es automática, no hay registro y todo el panel es de
          <strong> solo lectura</strong>: no se guardan cambios ni se toca información real.
        </p>
        <div className="admin-demo-actions">
          {pendingUrl ? (
            <a className="admin-btn admin-btn--primary" href={pendingUrl} target="_blank" rel="noreferrer" title="Portal del presupuesto pendiente: proponé cantidades y días o pedí una rebaja">
              <AdminIcon name="external" size={15} />
              <span>Probar la autogestión</span>
            </a>
          ) : null}
          {approvedUrl ? (
            <a className="admin-btn" href={approvedUrl} target="_blank" rel="noreferrer" title="Portal del presupuesto aprobado: plan de pagos y datos de pago de la empresa">
              <AdminIcon name="external" size={15} />
              <span>Presupuesto aprobado</span>
            </a>
          ) : null}
          <Link className="admin-btn" href="/dashboard">
            <AdminIcon name="overview" size={15} />
            <span>Ir al resumen</span>
          </Link>
          <form method="post" action="/api/demo/session">
            <input type="hidden" name="next" value="/demo" />
            <button className="admin-btn" type="submit" title="Vuelve a generar los datos simulados con fechas de hoy">
              <AdminIcon name="refresh" size={15} />
              <span>Reiniciar los datos</span>
            </button>
          </form>
        </div>
        <p className="admin-demo-footnote">
          Las ferias y marcas que aparecen son referencias reales del mercado paraguayo usadas como datos simulados, con
          contactos inventados; las fechas del calendario se re-anclan a hoy cada vez que entrás. Para salir de la demo usá
          «Salir de la demo» en el aviso superior.
        </p>
      </section>

      <section className="admin-kpis" aria-label="Datos simulados de la demo">
        <AdminKpi label="Clientes" value={formatNumber(clientCount)} note="finales y revendedores" />
        <AdminKpi label="Eventos" value={formatNumber(eventCount)} note="próximos, en curso y cerrados" />
        <AdminKpi label="Presupuestos" value={formatNumber(budgetCount)} note="aprobados, enviados y en negociación" />
        <AdminKpi label="Inventario" value={formatNumber(inventoryCount)} note="equipos e insumos" />
        <AdminKpi label="Proveedores" value={formatNumber(supplierCount)} note={`${formatNumber(openJobCount)} trabajos abiertos`} />
        <AdminKpi label="Promotoras" value={formatNumber(promoterCount)} note="equipo de campo" />
        <AdminKpi label="Leads nuevos" value={formatNumber(newLeadCount)} tone={newLeadCount > 0 ? "accent" : undefined} note="sin contactar" />
        <AdminKpi
          label="Avisos"
          value={formatNumber(feed.notificationCounts.overdue + feed.notificationCounts.soon)}
          tone={feed.notificationCounts.overdue > 0 ? "warn" : undefined}
          note={`${formatNumber(feed.notificationCounts.overdue)} vencidos · ${formatNumber(feed.notificationCounts.soon)} próximos`}
        />
      </section>

      <div className="admin-panel-grid">
        <AdminPanel
          title="Avisos operativos"
          meta={`${formatNumber(feed.notificationCounts.overdue)} vencidos · ${formatNumber(feed.notificationCounts.soon)} próximos`}
          action={
            <Link className="admin-panel-link" href="/calendario">
              Calendario
            </Link>
          }
        >
          {feed.notifications.length === 0 ? (
            <AdminEmpty icon="check" title="Sin avisos" hint="No hay vencimientos ni checklist pendiente en la demo." />
          ) : (
            <div className="admin-demo-list">
              {feed.notifications.slice(0, 6).map((notification) => (
                <Link
                  className="admin-notif-item"
                  key={notification.id}
                  href={notification.href}
                  data-level={notification.level}
                  title={`${notification.title}${notification.subtitle ? ` · ${notification.subtitle}` : ""} · ${formatCalendarDayShort(notification.date)}`}
                >
                  <AdminBadge tone={notification.level === "overdue" ? "danger" : notification.level === "soon" ? "warn" : "info"}>
                    {notification.level === "overdue" ? "Vencido" : notification.level === "soon" ? "Próximo" : "Aviso"}
                  </AdminBadge>
                  <span className="admin-notif-main">
                    <span className="admin-notif-title">{notification.title}</span>
                    <span className="admin-notif-sub">
                      {notification.subtitle ?? notification.href}
                    </span>
                  </span>
                  <span className="admin-notif-date">{formatCalendarDayShort(notification.date)}</span>
                  <AdminIcon name="arrow-right" size={14} />
                </Link>
              ))}
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          title="Auditoría"
          meta="Últimos cambios"
          action={
            <Link className="admin-panel-link" href="/eventos">
              Ver eventos
            </Link>
          }
        >
          {audits.length === 0 ? (
            <AdminEmpty icon="audit" title="Sin actividad" hint="La demo no tiene movimientos registrados todavía." />
          ) : (
            <div className="admin-demo-list">
              {audits.map((audit) => (
                <article
                  className="admin-demo-audit"
                  key={audit.id}
                  title={auditDetailText(audit.entity, audit.detail as AdminAuditDetail | null) ?? undefined}
                >
                  <AdminBadge tone={auditActionTone(audit.action)}>{auditActionLabel(audit.action)}</AdminBadge>
                  <span className="admin-notif-main">
                    <span className="admin-notif-title">{audit.summary}</span>
                    <span className="admin-notif-sub">
                      {auditEntityLabel(audit.entity)} · {audit.actorName}
                    </span>
                  </span>
                  <span className="admin-notif-date">{formatDate(audit.createdAt)}</span>
                </article>
              ))}
            </div>
          )}
          <p className="admin-demo-panel-note">
            En el panel real el historial completo es un módulo para OWNER/ADMIN; acá se muestra un resumen de la
            actividad simulada.
          </p>
        </AdminPanel>
      </div>

      <AdminPanel title="Próximos eventos" meta="Agenda simulada" action={<Link className="admin-panel-link" href="/eventos">Ver todos</Link>}>
        {upcomingEvents.length === 0 ? (
          <AdminEmpty icon="events" title="Sin eventos próximos" hint="Reiniciá los datos simulados para volver a generarlos." />
        ) : (
          <div className="admin-demo-list">
            {upcomingEvents.map((event) => (
              <Link className="admin-demo-event" key={event.id} href="/eventos">
                <AdminBadge tone="accent">{formatCalendarDayShort(dayKeyOf(event.startsAt ?? event.setupAt ?? now))}</AdminBadge>
                <span className="admin-notif-main">
                  <span className="admin-notif-title">{event.name}</span>
                  <span className="admin-notif-sub">
                    {event.client.company ?? event.client.name}
                    {event.location ? ` · ${event.location}` : ""}
                  </span>
                </span>
                <span className="admin-notif-date">{event.setupAt ? `Montaje ${formatDate(event.setupAt)}` : ""}</span>
                <AdminIcon name="arrow-right" size={14} />
              </Link>
            ))}
          </div>
        )}
      </AdminPanel>

      <AdminPanel title="Módulos" meta="Todo navegable en la demo" action={<Link className="admin-panel-link" href="/dashboard">Resumen</Link>}>
        <div className="admin-demo-modules">
          {modules.map((module) => (
            <Link className="admin-demo-module" key={module.href} href={module.href}>
              <span className="admin-demo-module-icon">
                <AdminIcon name={module.icon} size={17} />
              </span>
              <span className="admin-demo-module-text">
                <strong>{module.label}</strong>
                <small>{module.group}</small>
              </span>
              <AdminIcon name="arrow-right" size={14} />
            </Link>
          ))}
        </div>
      </AdminPanel>

      <AdminPanel title="Portal del cliente y exportaciones" meta="También funcionan en la demo">
        <div className="admin-demo-resources">
          <div className="admin-demo-resource">
            <h3>
              Autogestión <AdminBadge tone="warn">Pendiente</AdminBadge>
            </h3>
            <p>
              {openBudget ? `«${openBudget.title}»` : "Un presupuesto abierto"} está sin aprobar: entrá con el link o el QR
              y probá la autogestión del cliente — cambá cantidades y días, o pedí una rebaja. La solicitud queda pendiente
              para que el equipo la resuelva desde el panel.
            </p>
            {pendingUrl && pendingQr && openBudget?.publicToken ? (
              <div className="admin-demo-portal">
                <div className="admin-demo-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pendingQr }} />
                <div className="admin-demo-portal-data">
                  <p className="admin-demo-code">{openBudget.publicToken}</p>
                  <p className="admin-demo-portal-link" title={pendingUrl}>
                    {pendingUrl.replace(/^https?:\/\//, "")}
                  </p>
                  <a className="admin-btn admin-btn--primary" href={pendingUrl} target="_blank" rel="noreferrer">
                    <AdminIcon name="external" size={15} />
                    <span>Probar la autogestión</span>
                  </a>
                </div>
              </div>
            ) : null}
          </div>
          <div className="admin-demo-resource">
            <h3>
              Ya aprobado <AdminBadge tone="ok">Con datos de pago</AdminBadge>
            </h3>
            <p>
              {portalBudget ? `«${portalBudget.title}»` : "Un presupuesto aprobado"} fue aprobado por el cliente desde el
              portal (con nombre, fecha, IP y comentario). Muestra el plan de pagos —anticipo a transferir ahora
              {approvedInstallments > 0 ? ` y ${formatNumber(approvedInstallments)} cuota${approvedInstallments === 1 ? "" : "s"}` : ""}—
              y los datos de pago de la empresa (Ueno Bank), igual que la hoja imprimible.
            </p>
            {approvedUrl && approvedQr && portalBudget?.publicToken ? (
              <div className="admin-demo-portal">
                <div className="admin-demo-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: approvedQr }} />
                <div className="admin-demo-portal-data">
                  <p className="admin-demo-code">{portalBudget.publicToken}</p>
                  <p className="admin-demo-portal-link" title={approvedUrl}>
                    {approvedUrl.replace(/^https?:\/\//, "")}
                  </p>
                  <div className="admin-demo-actions admin-demo-actions--inline">
                    <a className="admin-btn admin-btn--primary" href={approvedUrl} target="_blank" rel="noreferrer">
                      <AdminIcon name="external" size={15} />
                      <span>Ver el aprobado</span>
                    </a>
                    {portalBudget ? (
                      <Link className="admin-btn" href={`/imprimir/presupuesto/${portalBudget.id}`}>
                        <AdminIcon name="print" size={15} />
                        <span>Hoja con el logo</span>
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="admin-demo-resource">
            <h3>PDF y CSV</h3>
            <p>
              Las vistas imprimibles salen de datos reales de la demo: orden de trabajo del evento, presupuesto con QR y
              reporte mensual. Los CSV se descargan desde Inventario y Finanzas.
            </p>
            <div className="admin-demo-actions admin-demo-actions--inline">
              <Link className="admin-btn" href="/imprimir/reporte">
                <AdminIcon name="print" size={15} />
                <span>Reporte</span>
              </Link>
              <Link className="admin-btn" href="/finanzas">
                <AdminIcon name="download" size={15} />
                <span>CSV de finanzas</span>
              </Link>
              <a className="admin-btn" href={publicConfig.siteUrl} target="_blank" rel="noreferrer">
                <AdminIcon name="external" size={15} />
                <span>Ver el sitio</span>
              </a>
            </div>
          </div>
        </div>
      </AdminPanel>
    </div>
  );
}

/** Sesión real abierta: entrar a la demo reemplaza la sesión, así que se confirma. */
function DemoInvite({ userName }: { userName: string }) {
  return (
    <div className="admin-module-page">
      <section className="admin-demo-hero">
        <span className="admin-demo-badge">DEMO</span>
        <h2 className="admin-demo-title">Entrar a la demo pública</h2>
        <p className="admin-demo-lede">
          Tenés una sesión abierta como <strong>{userName}</strong>. Entrar a la demo crea una sesión de visitante
          (solo lectura) en la organización demo y <strong>reemplaza la sesión actual</strong>; para volver a tu panel
          iniciá sesión otra vez.
        </p>
        <div className="admin-demo-actions">
          <form method="post" action="/api/demo/session">
            <input type="hidden" name="next" value="/demo" />
            <button className="admin-btn admin-btn--primary" type="submit">
              <AdminIcon name="power" size={15} />
              <span>Entrar a la demo</span>
            </button>
          </form>
          <Link className="admin-btn" href="/dashboard">
            <AdminIcon name="overview" size={15} />
            <span>Volver a mi panel</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
