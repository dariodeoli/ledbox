import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { parsePeriod, resolvePeriod } from "@/lib/platform/periods";
import { EMPRESA_SORTS, loadEmpresaDetail, loadEmpresas, loadPlanOptions } from "@/lib/platform/queries/empresas";
import { PAGE_SIZE, parseTableParams, searchAllowed, withParams, type RawParams } from "@/lib/platform/tablas";
import { rateLimit } from "@/lib/server/rate-limit";
import { formatDate, formatDateTime, formatMoney } from "@/lib/admin-format";
import { reenviarInvitacionAction } from "./acciones";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PeriodChips } from "@/components/platform/PeriodChips";
import { FilterForm } from "@/components/platform/FilterForm";
import { TablePager } from "@/components/platform/TablePager";
import { SortHeader } from "@/components/platform/SortHeader";

export const dynamic = "force-dynamic";

const BASE = "/superadmin/empresas";
type SearchParams = Promise<RawParams>;

function strings(params: RawParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) out[key] = v;
  }
  return out;
}

const MAIL_NOTICE: Record<string, string> = {
  sent: "Los correos de invitación salieron. El link vence en 7 días.",
  failed: "No pudimos enviar algún correo. Probá «Reenviar invitación» desde el detalle.",
  skipped: "Los correos no se enviaron (servicio de correo no configurado). Probá «Reenviar invitación» cuando esté listo.",
  limite: "Demasiados reenvíos seguidos. Esperá unos minutos.",
  error: "No encontramos una invitación para reenviar.",
};

/** Mensaje de resultado tras un alta o un reenvío (nunca incluye el link: solo viaja por correo). */
function noticeFor(current: Record<string, string>): string | null {
  const mail = current.alta ?? current.reenvio;
  if (!mail || !MAIL_NOTICE[mail]) return null;
  return (current.alta ? "Empresa creada. " : "") + MAIL_NOTICE[mail];
}

export default async function EmpresasPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const { userId } = await requirePlatformAdmin();
  const params = await searchParams;
  const range = resolvePeriod(parsePeriod(params.p));
  const plans = await loadPlanOptions();
  const table = parseTableParams(params, {
    sorts: EMPRESA_SORTS,
    filterOptions: { activa: ["si", "no"], plan: plans.map((plan) => plan.code) },
  });
  // El límite va ANTES de consultar: pasado el tope no se toca la base con el texto de búsqueda.
  const allowed = await searchAllowed(userId, table.q, rateLimit);
  const [data, detail] = await Promise.all([
    allowed ? loadEmpresas(range, table) : Promise.resolve(null),
    table.detail ? loadEmpresaDetail(table.detail) : Promise.resolve(null),
  ]);
  const current = strings(params);
  const exportHref = withParams(`${BASE}/exportar`, params, { pag: undefined, detalle: undefined });
  return (
    <PlatformShell active="empresas" title="Empresas">
      <div className="platform-page">
        <div className="platform-toolbar">
          <div><Link className="admin-btn admin-btn--primary platform-btn" href={`${BASE}/nueva`}>Nueva empresa</Link></div>
          <PeriodChips basePath={BASE} params={params} active={range.key} />
          <FilterForm
            basePath={BASE}
            current={current}
            q={table.q}
            searchLabel="Buscar empresas por nombre o slug"
            filters={[
              { name: "activa", label: "Estado", value: table.filters.activa ?? "", options: [{ value: "", label: "Estado: todas" }, { value: "si", label: "Activas" }, { value: "no", label: "Inactivas" }] },
              { name: "plan", label: "Plan", value: table.filters.plan ?? "", options: [{ value: "", label: "Plan: todos" }, ...plans.map((plan) => ({ value: plan.code, label: plan.name }))] },
            ]}
          />
          <p className="platform-hint">
            Monto aprobado del período «{range.label}» (incluye lo eliminado). Sin la empresa demo
            {data ? ` (${data.demoOrgs} excluida${data.demoOrgs === 1 ? "" : "s"})` : ""}. <a href={exportHref}>Exportar CSV</a>
          </p>
        </div>
        {noticeFor(strings(params)) ? <p className="platform-notice" role="status">{noticeFor(strings(params))}</p> : null}
        {!allowed ? (
          <p className="platform-notice" role="alert">Demasiados intentos de búsqueda. Esperá unos minutos y volvé a probar.</p>
        ) : null}
        <div className="platform-split" data-open={detail || table.detail ? "true" : undefined}>
          <section className="platform-panel" aria-label="Empresas">
            {data ? (
              <>
                <div className="platform-table-wrap">
                  <table className="platform-table">
                    <caption className="platform-sr-only">Empresas reales</caption>
                    <thead>
                      <tr>
                        <SortHeader basePath={BASE} params={params} sortKey="nombre" active={table.sort} dir={table.dir}>Empresa</SortHeader>
                        <th scope="col">Plan</th>
                        <th scope="col">Activa</th>
                        <SortHeader basePath={BASE} params={params} sortKey="alta" active={table.sort} dir={table.dir}>Alta</SortHeader>
                        <SortHeader basePath={BASE} params={params} sortKey="miembros" active={table.sort} dir={table.dir}>Miembros</SortHeader>
                        <SortHeader basePath={BASE} params={params} sortKey="eventos" active={table.sort} dir={table.dir}>Eventos</SortHeader>
                        <SortHeader basePath={BASE} params={params} sortKey="monto" active={table.sort} dir={table.dir}>Monto aprobado</SortHeader>
                        <SortHeader basePath={BASE} params={params} sortKey="actividad" active={table.sort} dir={table.dir}>Última actividad</SortHeader>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.id} data-selected={table.detail === row.id ? "true" : undefined}>
                          <th scope="row">
                            <Link href={withParams(BASE, params, { detalle: row.id })}>{row.name}</Link>
                            <small>{row.slug}</small>
                          </th>
                          <td>{row.plan ?? "Sin asignar"}</td>
                          <td>{row.active ? "Sí" : "No"}</td>
                          <td>{formatDate(row.createdAt)}</td>
                          <td className="platform-num">{row.members}</td>
                          <td className="platform-num">{row.events}</td>
                          <td className="platform-num">{formatMoney(row.approved)}</td>
                          <td>{row.lastActivity ? formatDateTime(row.lastActivity) : "sin actividad"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager basePath={BASE} params={params} page={data.page} total={data.total} pageSize={data.pageSize || PAGE_SIZE} />
              </>
            ) : null}
          </section>
          {table.detail ? (
            <aside className="platform-detail" aria-label="Detalle de empresa">
              <Link className="platform-chip" href={withParams(BASE, params, { detalle: undefined })}>Cerrar</Link>
              {detail ? (
                <>
                  <h2>{detail.name}</h2>
                  <dl className="platform-facts">
                    <div><dt>Slug</dt><dd>{detail.slug}</dd></div>
                    <div><dt>Activa</dt><dd>{detail.active ? "Sí" : "No"}</dd></div>
                    <div><dt>Alta</dt><dd>{formatDate(detail.createdAt)}</dd></div>
                    <div><dt>Plan</dt><dd>{detail.plan?.name ?? "Sin asignar"}</dd></div>
                  </dl>
                  {detail.usage ? (
                    <>
                      <h3>Uso del plan</h3>
                      <dl className="platform-facts">
                        <div><dt>Usuarios</dt><dd>{detail.usage.users.used} de {detail.usage.users.limit ?? "sin tope"} ({detail.usage.users.pendingInvitations} invitaciones pendientes)</dd></div>
                        <div><dt>Eventos de {detail.usage.events.periodLabel}</dt><dd>{detail.usage.events.used} de {detail.usage.events.limit ?? "sin tope"}</dd></div>
                      </dl>
                    </>
                  ) : null}
                  <h3>Invitaciones sin aceptar</h3>
                  {detail.invitations.length === 0 ? (
                    <p className="platform-hint">No hay invitaciones sin aceptar.</p>
                  ) : (
                    <ul className="platform-list">
                      {detail.invitations.map((invitation) => (
                        <li key={invitation.id}>
                          {invitation.email} · {invitation.role === "OWNER" ? "dueño" : "administrador"} · {invitation.status === "expired" ? "vencida" : invitation.status === "revoked" ? "revocada" : "pendiente"} · vence {formatDateTime(invitation.expiresAt)}
                          <form action={reenviarInvitacionAction}>
                            <input type="hidden" name="organizationId" value={detail.id} />
                            <input type="hidden" name="invitationId" value={invitation.id} />
                            <button type="submit" className="admin-btn platform-btn">Reenviar invitación</button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3>Solicitudes de plan pendientes</h3>
                  {detail.pendingRequests.length === 0 ? (
                    <p className="platform-hint">No hay solicitudes pendientes.</p>
                  ) : (
                    <ul className="platform-list">
                      {detail.pendingRequests.map((request) => (
                        <li key={request.id}>{request.planName} · pidió {request.requestedBy} · {formatDateTime(request.createdAt)}</li>
                      ))}
                    </ul>
                  )}
                  <p className="platform-hint">El resto del detalle es de solo lectura.</p>
                </>
              ) : (
                <p className="platform-hint">No encontramos esa empresa.</p>
              )}
            </aside>
          ) : null}
        </div>
      </div>
    </PlatformShell>
  );
}
