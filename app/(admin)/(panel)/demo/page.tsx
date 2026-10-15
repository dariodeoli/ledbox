import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { DemoIntro } from "@/components/admin/DemoIntro";
import { DemoTour } from "@/components/admin/DemoTour";
import { AdminPanel } from "@/components/admin/AdminUI";
import { formatNumber } from "@/lib/admin-format";
import { DEMO_STRONG_CASES, type DemoStrongCaseId } from "@/lib/demo-tour";
import { portalBudgetUrl } from "@/lib/public-config";
import { getAuthenticatedAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { DEMO_ORGANIZATION_NAME, ensureDemoData, isDemoOrganizationId } from "@/lib/server/demo-data";
import { isSandboxOrg } from "@/lib/server/demo-sandbox";
import { dayKeyOf, dayStart } from "@/lib/server/notifications";
import { rejectedChequeWhere } from "@/lib/server/resumen";

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
 * Entrada a la demo pública (issue #14), liviana (13-10-2026).
 *
 * Sin sesión redirige al endpoint que la provisiona (`GET /api/demo/session`) y
 * vuelve acá; con la sesión demo muestra solo lo que hace falta para empezar: el
 * recorrido guiado y los casos fuertes como lista compacta con su conteo real. El
 * panel completo (Resumen, Finanzas, Eventos…) es la demo en sí; las cifras y las
 * tarjetas que antes vivían acá están en cada módulo. Si la sesión abierta es de
 * una cuenta real no se reemplaza sin aviso: se pide confirmación.
 *
 * Todo se lee de la organización demo (`activeOrganizationId` de la sesión), así
 * que nada de otras empresas entra en esta pantalla. Los conteos usan las mismas
 * reglas que el Resumen (`lib/server/resumen.ts`), por eso los casos fuertes
 * aparecen también en «Para hacer hoy».
 */
export default async function DemoPage() {
  const auth = await getAuthenticatedAdmin();
  // En el host de la demo la URL visible puede ser `/` (rewrite, issue #53): el
  // `next` vuelve a esa misma ruta original. Fuera de ese host (dev o admin),
  // el índice sigue siendo `/demo`.
  const requestHeaders = await headers();
  const nextPath = requestHeaders.get("x-pathname") || "/demo";
  if (!auth) redirect(`/api/demo/session?next=${encodeURIComponent(nextPath)}`);

  const sandbox = await isSandboxOrg(auth.session.activeOrganizationId);
  if (!sandbox && !(await isDemoOrganizationId(auth.session.activeOrganizationId))) {
    return <DemoInvite userName={auth.user.name} nextPath={nextPath} />;
  }
  const organizationId = auth.session.activeOrganizationId as string;
  const now = new Date();
  const todayStart = dayStart(dayKeyOf(now));

  const [
    newLeadCount,
    openJobCount,
    portalBudget,
    openBudgetRow,
    overdueCount,
    rejectedCheques,
    riskEventCount,
    unavailablePromoters,
    damagedUnits,
    toDefineExpenses,
    proofCount,
    awaitingOverdueCount,
  ] = await Promise.all([
    db.lead.count({ where: { organizationId, status: "NEW" } }),
    db.supplierJob.count({ where: { organizationId, status: { notIn: ["PAID", "CANCELLED"] } } }),
    db.budget.findFirst({
      where: { organizationId, approvedAt: { not: null }, publicToken: { not: null } },
      orderBy: { approvedAt: "desc" },
      select: { publicToken: true },
    }),
    // Presupuesto abierto para recorrer la autogestión: link activo y sin
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
      select: { publicToken: true },
    }),
    // Casos difíciles de la demo (issue #24): derivados del dato real, sin
    // campos nuevos. Mora = cobros pendientes con vencimiento pasado.
    db.clientPayment.count({ where: { organizationId, status: "PENDING", dueAt: { lt: todayStart } } }),
    db.clientPayment.count({ where: rejectedChequeWhere(organizationId, now) }),
    db.event.count({
      where: {
        organizationId,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        startsAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
        tasks: { some: {}, none: { completedAt: { not: null } } },
      },
    }),
    db.promoter.count({ where: { organizationId, active: true, availability: "UNAVAILABLE" } }),
    db.eventInventory.aggregate({
      where: { event: { organizationId } },
      _sum: { damagedQuantity: true, missingQuantity: true },
    }),
    db.expense.count({ where: { organizationId, eventId: null } }),
    db.expectedPayment.count({ where: { organizationId, status: "PROOF" } }),
    db.expectedPayment.count({ where: { organizationId, status: "AWAITING", dueAt: { lt: todayStart } } }),
  ]);

  // Autogestión siempre viva: red de seguridad (issue #52). El portal de la demo
  // ya no escribe —las acciones se simulan en el navegador—, así que el caso no
  // debería consumirse; si otra vía lo cerró, se vuelve a sembrar el dataset,
  // igual que la entrada del portal, para que la demo conserve el caso.
  let openBudget = openBudgetRow;
  // En una sandbox no se vuelve a sembrar: es del visitante y «Reiniciar» la rehace entera.
  if (!openBudget && !sandbox) {
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
      select: { publicToken: true },
    });
  }

  const approvedUrl = portalBudget?.publicToken ? portalBudgetUrl(portalBudget.publicToken) : null;
  const pendingUrl = openBudget?.publicToken ? portalBudgetUrl(openBudget.publicToken) : null;
  const damagedTotal = (damagedUnits._sum.damagedQuantity ?? 0) + (damagedUnits._sum.missingQuantity ?? 0);

  // Accesos rápidos a los casos fuertes (issue #58): el conteo es el real de la
  // base y el tipo exige que estén todos los casos declarados en `lib/demo-tour`.
  const strongCaseCounts: Record<DemoStrongCaseId, number> = {
    mora: overdueCount,
    cheques: rejectedCheques,
    comprobantes: proofCount + awaitingOverdueCount,
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

      <AdminPanel
        title="Casos fuertes"
        icon="alert"
        meta="Los problemas que la demo siembra a propósito, con su conteo real"
        action={
          <Link className="admin-panel-link" href="/dashboard">
            Verlos en Inicio →
          </Link>
        }
      >
        <ul className="admin-demo-cases-list" aria-label="Casos fuertes de la demo">
          {DEMO_STRONG_CASES.map((strongCase) => {
            const count = strongCaseCounts[strongCase.id];
            return (
              <li key={strongCase.id}>
                <Link className="admin-demo-case-row" href={strongCase.href} title={strongCase.hint}>
                  <span className="admin-demo-case-count" data-tone={count > 0 ? strongCase.tone : undefined}>
                    {count > 0 ? formatNumber(count) : "—"}
                  </span>
                  <span className="admin-demo-case-text">
                    <strong>{strongCase.label}</strong>
                    <small>{strongCase.hint}</small>
                  </span>
                  <AdminIcon name="arrow-right" size={14} />
                </Link>
              </li>
            );
          })}
        </ul>
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
