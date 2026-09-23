import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { DemoIntro } from "@/components/admin/DemoIntro";
import { DemoTour } from "@/components/admin/DemoTour";
import { AdminBadge, AdminCountdown, AdminEmpty, AdminKpi, AdminPanel } from "@/components/admin/AdminUI";
import {
  adminRoleLabel,
  auditActionLabel,
  auditActionTone,
  auditDetailText,
  auditEntityLabel,
  checklistProgress,
  expenseCategoryLabel,
  expectedPaymentStatusLabel,
  expectedPaymentStatusTone,
  formatCalendarDayShort,
  formatDate,
  formatMoney,
  formatNumber,
  invitationStatusLabel,
  invitationStatusTone,
  isUpcomingWithin,
  mailCategoryLabel,
  mailStatusLabel,
  mailStatusTone,
  treasuryAccountTypeLabel,
  treasuryAccountTypeTone,
  treasuryDirectionLabel,
  treasuryDirectionTone,
} from "@/lib/admin-format";
import { adminNavGroups } from "@/lib/admin-policy";
import { DEMO_STRONG_CASES, type DemoStrongCaseId } from "@/lib/demo-tour";
import type { AdminAuditDetail } from "@/lib/admin-types";
import { portalBudgetUrl, publicConfig } from "@/lib/public-config";
import { qrSvg } from "@/lib/qr";
import { getAuthenticatedAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { DEMO_ORGANIZATION_NAME, ensureDemoData, isDemoOrganizationId } from "@/lib/server/demo-data";
import { parseMovementSourceSnapshot } from "@/lib/server/finance-snapshots";
import { dayKeyOf, dayStart } from "@/lib/server/notifications";
import { DEMO_OVERVIEW_BUCKET_MS, readDemoOverview } from "@/lib/server/demo-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Marca (21-09-2026): EventOS es la app y LedBox la empresa que la usa. La
  // demo es la demo de EventOS; la empresa de ejemplo sigue siendo «LedBox Demo».
  title: { absolute: "Demo de EventOS · LedBox Demo" },
  description: "Demo pública de EventOS (la app de gestión de LedBox) con datos simulados y sin registro.",
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
  // En el host de la demo la URL visible puede ser `/` (rewrite, issue #53): el
  // `next` vuelve a esa misma ruta original. Fuera de ese host (dev o admin),
  // el índice sigue siendo `/demo`.
  const requestHeaders = await headers();
  const nextPath = requestHeaders.get("x-pathname") || "/demo";
  if (!auth) redirect(`/api/demo/session?next=${encodeURIComponent(nextPath)}`);

  if (!(await isDemoOrganizationId(auth.session.activeOrganizationId))) {
    return <DemoInvite userName={auth.user.name} nextPath={nextPath} />;
  }
  const organizationId = auth.session.activeOrganizationId as string;
  const now = new Date();
  const todayStart = dayStart(dayKeyOf(now));

  const {
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
    openBudgetRow,
    overduePayments,
    rejectedCheques,
    riskEventCount,
    unavailablePromoters,
    toDefinePromoters,
    damagedUnits,
    cancelledEventCount,
    treasuryAccounts,
    treasuryMovements,
    treasuryGrouped,
    treasuryTransfersIn,
    expenseRows,
    toDefineExpenses,
    expenseCount,
    expectedRows,
    invitationRows,
    mailRows,
  } = await readDemoOverview(organizationId, Math.floor(now.getTime() / DEMO_OVERVIEW_BUCKET_MS));

  // Autogestión siempre viva: red de seguridad (issue #52). El portal de la demo
  // ya no escribe —las acciones se simulan en el navegador—, así que el caso no
  // debería consumirse; si otra vía lo cerró, se vuelve a sembrar el dataset,
  // igual que la entrada del portal, para que la demo conserve el caso.
  let openBudget = openBudgetRow;
  if (!openBudget) {
    await ensureDemoData({ reset: true });
    openBudget = await db.budget.findFirst({
      where: {
        organizationId,
        publicToken: { not: null },
        approvedAt: null,
        revisionRequestedAt: null,
        status: { in: ["SENT", "NEGOTIATING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, publicToken: true, status: true, client: { select: { company: true, name: true } } },
    });
  }

  const modules = adminNavGroups("VIEWER").flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  const approvedUrl = portalBudget?.publicToken ? portalBudgetUrl(portalBudget.publicToken) : null;
  const pendingUrl = openBudget?.publicToken ? portalBudgetUrl(openBudget.publicToken) : null;
  const [approvedQr, pendingQr] = await Promise.all([
    approvedUrl ? qrSvg(approvedUrl, 168) : Promise.resolve(null),
    pendingUrl ? qrSvg(pendingUrl, 168) : Promise.resolve(null),
  ]);
  const approvedInstallments = Array.isArray(portalBudget?.installmentsJson) ? portalBudget.installmentsJson.length : 0;
  const overdueAmount = overduePayments._sum.amount ?? 0;
  const overdueCount = overduePayments._count._all;
  const damagedTotal = (damagedUnits._sum.damagedQuantity ?? 0) + (damagedUnits._sum.missingQuantity ?? 0);
  /** Plural simple para los textos de la demo (`1 dañado`, `2 faltantes`). */
  const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;
  const inventoryNoteParts: string[] = [];
  const damagedCount = damagedUnits._sum.damagedQuantity ?? 0;
  const missingCount = damagedUnits._sum.missingQuantity ?? 0;
  if (damagedCount > 0) inventoryNoteParts.push(plural(damagedCount, "dañado", "dañados"));
  if (missingCount > 0) inventoryNoteParts.push(plural(missingCount, "faltante", "faltantes"));

  // ── Tesorería (issue #27): el saldo se deriva igual que en el API —saldo
  // inicial + entradas − salidas ± transferencias—, nunca se guarda. ──
  const treasuryBalances = new Map<string, number>();
  for (const account of treasuryAccounts) treasuryBalances.set(account.id, account.openingBalance);
  for (const row of treasuryGrouped) {
    const current = treasuryBalances.get(row.accountId) ?? 0;
    const amount = row._sum.amount ?? 0;
    treasuryBalances.set(row.accountId, row.direction === "IN" ? current + amount : current - amount);
  }
  for (const row of treasuryTransfersIn) {
    if (!row.counterAccountId) continue;
    treasuryBalances.set(row.counterAccountId, (treasuryBalances.get(row.counterAccountId) ?? 0) + (row._sum.amount ?? 0));
  }
  const treasuryTotal = treasuryAccounts.reduce((sum, account) => sum + (treasuryBalances.get(account.id) ?? 0), 0);
  /** Etiqueta congelada del hecho que originó el movimiento (issue #20). */
  const movementLabel = (movement: (typeof treasuryMovements)[number]) =>
    parseMovementSourceSnapshot(movement.sourceSnapshot)?.label ?? treasuryDirectionLabel(movement.direction);

  // ── Conciliación (issue #28): lo esperado no es plata cobrada. ──
  const expectedProof = expectedRows.filter((row) => row.status === "PROOF");
  const expectedOverdue = expectedRows.filter((row) => row.status === "AWAITING" && row.dueAt !== null && row.dueAt < todayStart);
  const expectedPendingTotal =
    expectedProof.reduce((sum, row) => sum + row.amount, 0) + expectedOverdue.reduce((sum, row) => sum + row.amount, 0);
  const expectedPendingCount = expectedProof.length + expectedOverdue.length;
  const expectedConfirmedTotal = expectedRows.filter((row) => row.status === "CONFIRMED").reduce((sum, row) => sum + row.amount, 0);
  const pendingInvitations = invitationRows.filter((row) => row.status === "pending").length;
  const acceptedInvitations = invitationRows.filter((row) => row.status === "accepted").length;
  const failedMails = mailRows.filter((row) => row.status === "failed").length;

  // Accesos rápidos a los casos fuertes (issue #58): el conteo es el real de la
  // base y el tipo exige que estén todos los casos declarados en `lib/demo-tour`.
  const strongCaseCounts: Record<DemoStrongCaseId, number> = {
    mora: overdueCount,
    cheques: rejectedCheques,
    comprobantes: expectedPendingCount,
    checklist: riskEventCount,
    equipos: damagedTotal,
    promotoras: unavailablePromoters,
    gastos: toDefineExpenses,
    proveedores: openJobCount,
    leads: newLeadCount,
  };

  return (
    <div className="admin-module-page admin-demo-page">
      <DemoIntro
        organizationName={DEMO_ORGANIZATION_NAME}
        pendingUrl={pendingUrl}
        approvedUrl={approvedUrl}
        resetForm={
          <form method="post" action="/api/demo/session">
            <input type="hidden" name="next" value={nextPath} />
            <input type="hidden" name="reset" value="1" />
            <button
              className="admin-btn"
              type="submit"
              title="Reinicia la demo: vuelve a sembrar los datos simulados con las fechas de hoy (no toca datos reales)"
            >
              <AdminIcon name="refresh" size={15} />
              <span>Reiniciar la demo</span>
            </button>
          </form>
        }
      />

      <DemoTour />

      <section className="admin-kpis" aria-label="Datos simulados de la demo">
        <AdminKpi label="Clientes" icon="clients" value={formatNumber(clientCount)} note="finales y revendedores" />
        <AdminKpi
          label="Eventos" icon="events"
          value={formatNumber(eventCount)}
          note={cancelledEventCount > 0 ? `no cancelados · ${plural(cancelledEventCount, "cancelado", "cancelados")}` : "próximos, en curso y cerrados"}
        />
        <AdminKpi label="Presupuestos" icon="budgets" value={formatNumber(budgetCount)} note="aprobados, enviados, en negociación y perdidos" />
        <AdminKpi
          label="Inventario" icon="inventory"
          value={formatNumber(inventoryCount)}
          note={inventoryNoteParts.length > 0 ? inventoryNoteParts.join(" · ") : "equipos e insumos"}
          tone={damagedTotal > 0 ? "warn" : undefined}
        />
        <AdminKpi label="Proveedores" icon="suppliers" value={formatNumber(supplierCount)} note={`${formatNumber(openJobCount)} trabajos abiertos`} />
        <AdminKpi
          label="Promotoras" icon="promoters"
          value={formatNumber(promoterCount)}
          note={`${plural(unavailablePromoters, "no disponible", "no disponibles")} · ${formatNumber(toDefinePromoters)} a definir`}
          tone={unavailablePromoters + toDefinePromoters > 0 ? "warn" : undefined}
        />
        <AdminKpi label="Leads nuevos" icon="leads" value={formatNumber(newLeadCount)} tone={newLeadCount > 0 ? "accent" : undefined} note="sin contactar, uno hace semanas" />
        <AdminKpi
          label="Mora" icon="alert"
          value={overdueCount > 0 ? formatMoney(overdueAmount) : "—"}
          tone={overdueCount > 0 ? "danger" : undefined}
          note={`${plural(overdueCount, "cobro vencido", "cobros vencidos")}${rejectedCheques > 0 ? ` · ${plural(rejectedCheques, "cheque rechazado", "cheques rechazados")}` : ""}`}
        />
        <AdminKpi
          label="Tesorería" icon="wallet"
          value={formatMoney(treasuryTotal)}
          note={`${plural(treasuryAccounts.length, "cuenta", "cuentas")} · saldo derivado de movimientos`}
        />
        <AdminKpi
          label="Por confirmar" icon="clock"
          value={expectedPendingCount > 0 ? formatMoney(expectedPendingTotal) : "—"}
          tone={expectedPendingCount > 0 ? "warn" : undefined}
          note={`${plural(expectedProof.length, "comprobante en revisión", "comprobantes en revisión")} · ${plural(expectedOverdue.length, "vencido sin comprobante", "vencidos sin comprobante")}`}
        />
        <AdminKpi
          label="Gastos" icon="receipt"
          value={formatNumber(expenseCount)}
          note={toDefineExpenses > 0 ? `${plural(toDefineExpenses, "gasto", "gastos")} «A definir» sin proyecto` : "todos con proyecto asignado"}
        />
        <AdminKpi
          label="Equipo" icon="users"
          value={formatNumber(invitationRows.length)}
          note={`${plural(pendingInvitations, "invitación pendiente", "invitaciones pendientes")} · ${plural(acceptedInvitations, "aceptada", "aceptadas")}`}
        />
        <AdminKpi
          label="Correos" icon="mail"
          value={formatNumber(mailRows.length)}
          tone={failedMails > 0 ? "warn" : undefined}
          note={failedMails > 0 ? `${plural(failedMails, "envío fallido", "envíos fallidos")} con su motivo` : "sin fallos registrados"}
        />
        <AdminKpi
          label="Checklist en riesgo" icon="alert"
          value={formatNumber(riskEventCount)}
          tone={riskEventCount > 0 ? "danger" : undefined}
          note="próximos sin tareas cumplidas"
        />
        <AdminKpi
          label="Avisos" icon="bell"
          value={formatNumber(feed.notificationCounts.overdue + feed.notificationCounts.soon)}
          tone={feed.notificationCounts.overdue > 0 ? "warn" : undefined}
          note={`${formatNumber(feed.notificationCounts.overdue)} vencidos · ${formatNumber(feed.notificationCounts.soon)} próximos`}
        />
      </section>

      <section className="admin-demo-cases" aria-label="Casos fuertes de la demo">
        <header className="admin-demo-cases-head">
          <h2 className="admin-panel-title">Casos fuertes</h2>
          <span className="admin-panel-meta">Los problemas que la demo siembra a propósito, con su conteo real</span>
        </header>
        <div className="admin-demo-cases-grid">
          {DEMO_STRONG_CASES.map((strongCase) => {
            const count = strongCaseCounts[strongCase.id];
            return (
              <Link className="admin-demo-case" key={strongCase.id} href={strongCase.href} title={strongCase.hint}>
                <span className="admin-demo-case-count" data-tone={count > 0 ? strongCase.tone : undefined}>
                  {count > 0 ? formatNumber(count) : "—"}
                </span>
                <span className="admin-demo-case-text">
                  <strong>{strongCase.label}</strong>
                  <small>{strongCase.hint}</small>
                </span>
                <AdminIcon name="arrow-right" size={14} />
              </Link>
            );
          })}
        </div>
      </section>

      <div className="admin-panel-grid">
        <AdminPanel
          title="Avisos operativos" icon="bell"
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
          title="Auditoría" icon="audit"
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

      <div className="admin-panel-grid">
        <AdminPanel
          title="Tesorería" icon="wallet"
          meta={`${formatMoney(treasuryTotal)} en ${plural(treasuryAccounts.length, "cuenta", "cuentas")}`}
          action={
            <Link className="admin-panel-link" href="/finanzas">
              Finanzas
            </Link>
          }
        >
          <div className="admin-demo-list">
            {treasuryAccounts.map((account) => (
              <article className="admin-demo-audit" key={account.id} title={`${treasuryAccountTypeLabel(account.type)} · ${account.name}`}>
                <AdminBadge tone={treasuryAccountTypeTone(account.type)}>{treasuryAccountTypeLabel(account.type)}</AdminBadge>
                <span className="admin-notif-main">
                  <span className="admin-notif-title">{account.name}</span>
                  <span className="admin-notif-sub">
                    {account.bank ?? (account.type === "CHEQUE" ? "Cheques en cartera" : "Caja de la empresa")}
                  </span>
                </span>
                <span className="admin-demo-amount">{formatMoney(treasuryBalances.get(account.id) ?? 0)}</span>
              </article>
            ))}
          </div>
          <p className="admin-demo-panel-note">
            El saldo no se guarda: es el saldo inicial más los movimientos. Abajo, los últimos movimientos del circuito
            real (cobros, pagos a proveedores, gastos y la transferencia del cheque ya cobrado en efectivo).
          </p>
          <div className="admin-demo-list">
            {treasuryMovements.map((movement) => (
              <article className="admin-demo-audit" key={movement.id} title={movement.notes ?? undefined}>
                <AdminBadge tone={treasuryDirectionTone(movement.direction)}>{treasuryDirectionLabel(movement.direction)}</AdminBadge>
                <span className="admin-notif-main">
                  <span className="admin-notif-title">{movementLabel(movement)}</span>
                  <span className="admin-notif-sub">
                    {movement.counterAccount
                      ? `${movement.account.name} → ${movement.counterAccount.name}`
                      : movement.account.name}
                  </span>
                </span>
                <span className="admin-demo-amount" data-direction={movement.direction}>
                  {`${movement.direction === "OUT" ? "−" : movement.direction === "IN" ? "+" : "⇄"} ${formatMoney(movement.amount)}`}
                </span>
              </article>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel
          title="Gastos y conciliación" icon="receipt"
          meta={`${plural(expenseCount, "gasto", "gastos")} · ${plural(expectedRows.length, "pago esperado", "pagos esperados")}`}
          action={
            <Link className="admin-panel-link" href="/finanzas">
              Ver en Finanzas
            </Link>
          }
        >
          <div className="admin-demo-list">
            {expenseRows.map((expense) => (
              <article
                className="admin-demo-audit"
                key={expense.id}
                title={`${expense.description}${expense.notes ? ` · ${expense.notes}` : ""}`}
              >
                <AdminBadge tone={expense.event ? "neutral" : "warn"}>{expenseCategoryLabel(expense.category)}</AdminBadge>
                <span className="admin-notif-main">
                  <span className="admin-notif-title">{expense.description}</span>
                  <span className="admin-notif-sub">
                    {expense.event ? expense.event.name : "A definir"} · {expense.account.name}
                  </span>
                </span>
                <span className="admin-demo-amount">{formatMoney(expense.amount)}</span>
              </article>
            ))}
          </div>
          <p className="admin-demo-panel-note">
            {toDefineExpenses > 0
              ? `Hay ${plural(toDefineExpenses, "gasto", "gastos")} «A definir» (sin proyecto) para probar la asignación desde la fila en Finanzas.`
              : "Todos los gastos tienen proyecto asignado."}{" "}
            Los cobros y pagos esperados muestran la conciliación: comprobantes en revisión, vencidos sin comprobante y
            confirmados con su movimiento.
          </p>
          <div className="admin-demo-list">
            {expectedRows.map((expected) => {
              const overdue = expected.status === "AWAITING" && expected.dueAt !== null && expected.dueAt < todayStart;
              // Etiqueta corta: la fila entra en 360 px con el monto alineado.
              const statusLabel =
                expected.status === "PROOF"
                  ? "En revisión"
                  : expected.status === "AWAITING"
                    ? overdue
                      ? "Vencido"
                      : "Esperando"
                    : expectedPaymentStatusLabel(expected.status);
              return (
                <article className="admin-demo-audit" key={expected.id} title={expected.notes ?? undefined}>
                  <AdminBadge tone={overdue ? "danger" : expectedPaymentStatusTone(expected.status)}>{statusLabel}</AdminBadge>
                  <span className="admin-notif-main">
                    <span className="admin-notif-title">
                      {expected.label} · {expected.budget.client.company ?? expected.budget.client.name}
                    </span>
                    <span className="admin-notif-sub">
                      {expected.budget.title}
                      {expected.dueAt ? ` · ${overdue ? "venció" : "vence"} el ${formatCalendarDayShort(dayKeyOf(expected.dueAt))}` : ""}
                      {expected.proof ? " · con comprobante" : ""}
                    </span>
                  </span>
                  <span className="admin-demo-amount">{formatMoney(expected.amount)}</span>
                </article>
              );
            })}
          </div>
          <p className="admin-demo-panel-note">
            Confirmado en cuentas: {formatMoney(expectedConfirmedTotal)}. Lo esperado no es plata cobrada: la confirmación
            crea el cobro y su movimiento, y los comprobantes en revisión no se dan por cobrados.
          </p>
        </AdminPanel>
      </div>

      <AdminPanel
        title="Equipo, correos e identidad" icon="users"
        meta={`${plural(invitationRows.length, "invitación", "invitaciones")} · ${plural(mailRows.length, "envío", "envíos")}`}
      >
        <div className="admin-demo-resources">
          <div className="admin-demo-resource">
            <h3>
              <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                <AdminIcon name="users" size={11} />
              </span>
              Invitaciones al equipo
            </h3>
            <p>
              La empresa demo ya tiene equipo simulado: una invitación quedó pendiente (con su correo enviado) y otra fue
              aceptada, así que la persona figura como miembro. En el panel real, invitar y revocar es de OWNER/ADMIN;
              acá se ve el resultado.
            </p>
            <div className="admin-demo-list admin-demo-list--flush">
              {invitationRows.map((invitation) => (
                <article className="admin-demo-audit" key={invitation.id} title={`Invitó ${invitation.invitedByName}`}>
                  <AdminBadge tone={invitationStatusTone(invitation.status)}>{invitationStatusLabel(invitation.status)}</AdminBadge>
                  <span className="admin-notif-main">
                    <span className="admin-notif-title">{invitation.email}</span>
                    <span className="admin-notif-sub">
                      {adminRoleLabel(invitation.role)} · {invitation.status === "accepted" ? `aceptada por ${invitation.acceptedByName ?? invitation.email}` : `vence el ${formatDate(invitation.expiresAt)}`}
                    </span>
                  </span>
                  <span className="admin-notif-date">{formatDate(invitation.createdAt)}</span>
                </article>
              ))}
            </div>
          </div>
          <div className="admin-demo-resource">
            <h3>
              <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                <AdminIcon name="mail" size={11} />
              </span>
              Historial de correos
            </h3>
            <p>
              Cada fila es un intento real contra el proveedor: el presupuesto enviado, el recordatorio de cobro, el correo
              de prueba y un <strong>fallo con su motivo</strong>. El módulo completo vive en Configuración (OWNER/ADMIN).
            </p>
            <div className="admin-demo-list admin-demo-list--flush">
              {mailRows.map((mail) => (
                <article className="admin-demo-audit" key={mail.id} title={mail.error ?? undefined}>
                  <AdminBadge tone={mailStatusTone(mail.status)}>{mailStatusLabel(mail.status)}</AdminBadge>
                  <span className="admin-notif-main">
                    <span className="admin-notif-title">{mail.subject}</span>
                    <span className="admin-notif-sub">
                      {mailCategoryLabel(mail.category)} · {mail.to}
                      {mail.error ? ` · ${mail.error}` : ""}
                    </span>
                  </span>
                  <span className="admin-notif-date">{formatDate(mail.sentAt)}</span>
                </article>
              ))}
            </div>
          </div>
          <div className="admin-demo-resource">
            <h3>
              <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                <AdminIcon name="image" size={11} />
              </span>
              Identidad de la demo
            </h3>
            <p>
              La empresa demo tiene sus dos logos (claro y oscuro) y el equipo tiene avatar: por eso el shell muestra un
              logo propio y no el monograma de respaldo. El usuario demo entra sin PIN y con auto-bloqueo «nunca»: la demo
              no se bloquea sola.
            </p>
            <p className="admin-demo-footnote">
              Las imágenes se generan en la base (PNG) y se sirven solo con sesión, igual que en el panel real.
            </p>
          </div>
        </div>
      </AdminPanel>

      <AdminPanel title="Próximos eventos" icon="calendar" meta="Agenda simulada" action={<Link className="admin-panel-link" href="/eventos">Ver todos</Link>}>
        {upcomingEvents.length === 0 ? (
          <AdminEmpty icon="events" title="Sin eventos próximos" hint="Reiniciá los datos simulados para volver a generarlos." />
        ) : (
          <div className="admin-demo-list">
            {upcomingEvents.map((event) => {
              const progress = checklistProgress(event.tasks, { risk: isUpcomingWithin(event.startsAt) });
              return (
                <Link className="admin-demo-event" key={event.id} href="/eventos">
                  <AdminBadge tone="accent">{formatCalendarDayShort(dayKeyOf(event.startsAt ?? event.setupAt ?? now))}</AdminBadge>
                  <span className="admin-notif-main">
                    <span className="admin-notif-title">{event.name}</span>
                    <span className="admin-notif-sub">
                      {event.client.company ?? event.client.name}
                      {event.location ? ` · ${event.location}` : ""}
                    </span>
                  </span>
                  {event.tasks.length > 0 ? (
                    <AdminBadge tone={progress.tone} title={progress.title}>
                      {progress.label}
                    </AdminBadge>
                  ) : null}
                  <span className="admin-notif-date">
                    {event.setupAt ? `Montaje ${formatDate(event.setupAt)}` : ""}
                    <AdminCountdown
                      value={event.startsAt}
                      short
                      className="admin-countdown--inline"
                      title={`Cuánto falta para el inicio: ${event.name}`}
                    />
                  </span>
                  <AdminIcon name="arrow-right" size={14} />
                </Link>
              );
            })}
          </div>
        )}
      </AdminPanel>

      <AdminPanel title="Módulos" icon="overview" meta="Todo navegable en la demo" action={<Link className="admin-panel-link" href="/dashboard">Resumen</Link>}>
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

      <AdminPanel title="Portal del cliente y exportaciones" icon="globe" meta="También funcionan en la demo">
        <div className="admin-demo-resources">
          <div className="admin-demo-resource">
            <h3>
              <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                <AdminIcon name="globe" size={11} />
              </span>
              Autogestión <AdminBadge tone="warn">Pendiente</AdminBadge>
            </h3>
            <p>
              {openBudget ? `«${openBudget.title}»` : "Un presupuesto abierto"} está sin aprobar: entrá con el link o el QR
              y probá la autogestión del cliente — cambá cantidades y días, o pedí una rebaja. La simulación corre en tu
              navegador (la demo no se escribe) y la solicitud pendiente del panel sigue siendo la del dataset.
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
              <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                <AdminIcon name="check" size={11} />
              </span>
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
            <h3>
              <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                <AdminIcon name="download" size={11} />
              </span>
              PDF y CSV
            </h3>
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
function DemoInvite({ userName, nextPath }: { userName: string; nextPath: string }) {
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
            <input type="hidden" name="next" value={nextPath} />
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
