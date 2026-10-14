import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { USUARIO_SORTS, loadUsuarioDetail, loadUsuarios } from "@/lib/platform/queries/usuarios";
import { PAGE_SIZE, parseTableParams, searchAllowed, withParams, type RawParams } from "@/lib/platform/tablas";
import { rateLimit } from "@/lib/server/rate-limit";
import { adminRoleLabel, formatDate, formatDateTime } from "@/lib/admin-format";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { FilterForm } from "@/components/platform/FilterForm";
import { TablePager } from "@/components/platform/TablePager";
import { SortHeader } from "@/components/platform/SortHeader";

export const dynamic = "force-dynamic";

const BASE = "/superadmin/usuarios";
type SearchParams = Promise<RawParams>;
const YES_NO = [{ value: "", label: "Todos" }, { value: "si", label: "Sí" }, { value: "no", label: "No" }];

function strings(params: RawParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) out[key] = v;
  }
  return out;
}

export default async function UsuariosPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const { userId } = await requirePlatformAdmin();
  const params = await searchParams;
  const table = parseTableParams(params, {
    sorts: USUARIO_SORTS,
    filterOptions: { activa: ["si", "no"], verificado: ["si", "no"], pin: ["si", "no"] },
  });
  const allowed = await searchAllowed(userId, table.q, rateLimit);
  const [data, detail] = await Promise.all([
    allowed ? loadUsuarios(table) : Promise.resolve(null),
    table.detail ? loadUsuarioDetail(table.detail) : Promise.resolve(null),
  ]);
  const exportHref = withParams(`${BASE}/exportar`, params, { pag: undefined, detalle: undefined });
  return (
    <PlatformShell active="usuarios" title="Usuarios">
      <div className="platform-page">
        <div className="platform-toolbar">
          <FilterForm
            basePath={BASE}
            current={strings(params)}
            q={table.q}
            searchLabel="Buscar usuarios por nombre o correo"
            filters={[
              { name: "activa", label: "Activa", value: table.filters.activa ?? "", options: [{ value: "", label: "Activa: todas" }, { value: "si", label: "Activas" }, { value: "no", label: "Inactivas" }] },
              { name: "verificado", label: "Correo verificado", value: table.filters.verificado ?? "", options: YES_NO.map((o) => ({ ...o, label: o.value ? o.label : "Verificado: todos" })) },
              { name: "pin", label: "PIN", value: table.filters.pin ?? "", options: YES_NO.map((o) => ({ ...o, label: o.value ? o.label : "PIN: todos" })) },
            ]}
          />
          <p className="platform-hint">Solo usuarios con membresía activa en empresas reales (sin la demo). <a href={exportHref}>Exportar CSV</a></p>
        </div>
        {!allowed ? (
          <p className="platform-notice" role="alert">Demasiados intentos de búsqueda. Esperá unos minutos y volvé a probar.</p>
        ) : null}
        <div className="platform-split">
          <section className="platform-panel" aria-label="Usuarios">
            {data ? (
              <>
                <div className="platform-table-wrap">
                  <table className="platform-table">
                    <caption className="platform-sr-only">Usuarios de empresas reales</caption>
                    <thead>
                      <tr>
                        <SortHeader basePath={BASE} params={params} sortKey="nombre" active={table.sort} dir={table.dir}>Nombre</SortHeader>
                        <SortHeader basePath={BASE} params={params} sortKey="correo" active={table.sort} dir={table.dir}>Correo</SortHeader>
                        <th scope="col">Empresas y roles</th>
                        <th scope="col">Activa</th>
                        <SortHeader basePath={BASE} params={params} sortKey="ingreso" active={table.sort} dir={table.dir}>Último ingreso</SortHeader>
                        <SortHeader basePath={BASE} params={params} sortKey="actividad" active={table.sort} dir={table.dir}>Última actividad</SortHeader>
                        <th scope="col">PIN</th>
                        <th scope="col">Correo verificado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.id} data-selected={table.detail === row.id ? "true" : undefined}>
                          <th scope="row"><Link href={withParams(BASE, params, { detalle: row.id })}>{row.name}</Link></th>
                          <td>{row.email}</td>
                          <td className="platform-wrap">{row.companies.map((c) => `${c.org} (${adminRoleLabel(c.role)})`).join(", ") || "—"}</td>
                          <td>{row.active ? "Sí" : "No"}</td>
                          <td>{row.lastLogin ? formatDateTime(row.lastLogin) : "nunca"}</td>
                          <td>{row.lastActive ? formatDateTime(row.lastActive) : "sin datos"}</td>
                          <td>{row.hasPin ? "Sí" : "No"}</td>
                          <td>{row.emailVerified ? "Sí" : "No"}</td>
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
            <aside className="platform-detail" aria-label="Detalle de usuario">
              <Link className="platform-chip" href={withParams(BASE, params, { detalle: undefined })}>Cerrar</Link>
              {detail ? (
                <>
                  <h2>{detail.name}</h2>
                  <dl className="platform-facts">
                    <div><dt>Correo</dt><dd>{detail.email}</dd></div>
                    <div><dt>Activa</dt><dd>{detail.active ? "Sí" : "No"}</dd></div>
                    <div><dt>Alta</dt><dd>{formatDate(detail.createdAt)}</dd></div>
                    <div><dt>Último ingreso</dt><dd>{detail.lastLogin ? formatDateTime(detail.lastLogin) : "nunca"}</dd></div>
                    <div><dt>Última actividad</dt><dd>{detail.lastActive ? formatDateTime(detail.lastActive) : "sin datos"}</dd></div>
                    <div><dt>PIN</dt><dd>{detail.hasPin ? "Sí" : "No"}</dd></div>
                    <div><dt>Correo verificado</dt><dd>{detail.emailVerified ? "Sí" : "No"}</dd></div>
                  </dl>
                  <h3>Empresas</h3>
                  <ul className="platform-list">
                    {detail.memberships.map((m) => (
                      <li key={`${m.org}-${m.role}`}>{m.org} · {adminRoleLabel(m.role)}{m.active ? "" : " (inactiva)"}</li>
                    ))}
                  </ul>
                  <p className="platform-hint">Solo lectura.</p>
                </>
              ) : (
                <p className="platform-hint">No encontramos ese usuario.</p>
              )}
            </aside>
          ) : null}
        </div>
      </div>
    </PlatformShell>
  );
}
