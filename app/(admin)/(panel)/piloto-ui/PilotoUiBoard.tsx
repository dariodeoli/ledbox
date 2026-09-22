"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  CeldaMoneda,
  CELDA_DATO,
  CELDA_ENCABEZADO,
  CELDA_NUMERO,
  ChipEstado,
  DataTable,
  EmptyState,
  ErrorState,
  Money,
  Skeleton,
  Stat,
  Switch,
  fechaCorta,
  fechaDia,
  fechaHora,
  formatGs,
  montoTexto,
} from "owncoding-ui";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminToolbar,
} from "@/components/admin/AdminUI";
import { adminApiGet } from "@/lib/admin-api";
import { formatDate, formatDateTime, formatMoney, formatNumber, treasuryAccountTypeLabel } from "@/lib/admin-format";
import type { AdminTreasuryAccountRow, AdminTreasurySummary } from "@/lib/admin-types";
import { PilotoControles } from "./PilotoControles";

/**
 * Tablero del piloto OwnCoding UI (22-09-2026).
 *
 * Compara, con los mismos datos, los objetos del panel con los de la librería.
 * Los datos son los reales de tesorería de la empresa activa (demo incluida);
 * si la lectura falla, se muestran filas de EJEMPLO marcadas como tales para no
 * inventar métricas como si fueran reales.
 *
 * Vive solo en /piloto-ui: no está en el nav, no está en `lib/admin-routes` y
 * la página es `noindex`. No migra nada del panel.
 */

type Datos = { accounts: AdminTreasuryAccountRow[]; summary: AdminTreasurySummary };

const EJEMPLO: Datos = {
  accounts: [
    { id: "ej-1", name: "Efectivo", type: "CASH", bank: null, currency: "PYG", openingBalance: 1_500_000, sortOrder: 0, active: true, balance: 1_100_000 },
    { id: "ej-2", name: "Ueno Bank", type: "BANK", bank: "Ueno Bank", currency: "PYG", openingBalance: 12_000_000, sortOrder: 1, active: true, balance: 13_894_000 },
    { id: "ej-3", name: "Cheques a cobrar", type: "CHEQUE", bank: null, currency: "PYG", openingBalance: 4_000_000, sortOrder: 2, active: false, balance: 4_000_000 },
  ],
  summary: { cash: 1_100_000, bank: 13_894_000, cheque: 4_000_000, other: 0, total: 18_994_000, accounts: 3, activeAccounts: 2 },
};

/** Fecha de referencia del piloto: la misma para las dos columnas. */
const FECHA_MUESTRA = "2026-09-22T13:45:00.000Z";

export function PilotoUiBoard() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [intento, setIntento] = useState(0);
  const [oscuroLibreria, setOscuroLibreria] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oc = params.get("oc");
    if (oc === "light") setOscuroLibreria(false);
    if (oc === "dark") setOscuroLibreria(true);
  }, []);

  useEffect(() => {
    let activo = true;
    void adminApiGet<{ accounts?: AdminTreasuryAccountRow[]; summary?: AdminTreasurySummary }>("/api/admin/treasury", {
      fresh: intento > 0,
      fallbackError: "No pudimos leer la tesorería.",
    }).then((resultado) => {
      if (!activo) return;
      if (!resultado.ok) {
        setError(resultado.error);
        setDatos(EJEMPLO);
        return;
      }
      setError("");
      setDatos({
        accounts: resultado.data.accounts ?? [],
        summary: resultado.data.summary ?? EJEMPLO.summary,
      });
    });
    return () => {
      activo = false;
    };
  }, [intento]);

  // Modo oscuro de la librería: su contrato es la clase `dark` en <html>.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", oscuroLibreria);
    return () => document.documentElement.classList.remove("dark");
  }, [oscuroLibreria]);

  const recargar = useCallback(() => setIntento((valor) => valor + 1), []);
  const cuentas = datos?.accounts ?? [];
  const resumen = datos?.summary ?? EJEMPLO.summary;
  const esEjemplo = Boolean(error);

  return (
    <div className="admin-module-page piloto-page">
      <section className="piloto-intro">
        <AdminNote>
          <strong>Piloto OwnCoding UI v0.12.0</strong> — misma pantalla, mismos datos, dos kits. La columna izquierda es el panel
          actual; la derecha, los objetos de la librería. Este piloto no migra nada: no hay link en el nav, la ruta es{" "}
          <span className="piloto-code">noindex</span> y el panel real no cambió.
        </AdminNote>
        {esEjemplo ? (
          <AdminNote tone="error">
            No pudimos leer la tesorería real ({error}); las dos columnas muestran filas de EJEMPLO, marcadas como tales.
          </AdminNote>
        ) : null}
        <AdminToolbar>
          <AdminButton icon="refresh" onClick={recargar}>
            Recargar datos reales
          </AdminButton>
          <span className="piloto-oc piloto-switch">
            <Switch
              checked={oscuroLibreria}
              onChange={(event) => setOscuroLibreria(event.target.checked)}
              ariaLabel="Modo oscuro de la librería (clase dark en html)"
            />
            <span>Librería en oscuro (clase `dark` en &lt;html&gt;)</span>
          </span>
        </AdminToolbar>
      </section>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <AdminPanel title="KPIs de tesorería" icon="wallet" meta="AdminKpi vs Stat">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual · AdminKpi</span>
            <section className="admin-kpis">
              <AdminKpi label="Disponible en efectivo" icon="wallet" value={formatMoney(resumen.cash)} note="1 cuenta de efectivo" tone={resumen.cash > 0 ? "ok" : undefined} />
              <AdminKpi label="Disponible en banco" icon="bank" value={formatMoney(resumen.bank)} note="1 cuenta bancaria" />
              <AdminKpi label="Cheques a cobrar" icon="receipt" value={formatMoney(resumen.cheque)} note="1 cuenta de cheques" tone={resumen.cheque > 0 ? "warn" : undefined} />
              <AdminKpi label="Total disponible" icon="wallet" value={formatMoney(resumen.total)} note={`${formatNumber(resumen.activeAccounts)} activas de ${formatNumber(resumen.accounts)}`} />
            </section>
          </div>
          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería · Stat</span>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Disponible en efectivo" valor={montoTexto(resumen.cash)} sub="1 cuenta de efectivo" />
              <Stat label="Disponible en banco" valor={montoTexto(resumen.bank)} sub="1 cuenta bancaria" />
              <Stat label="Cheques a cobrar" valor={montoTexto(resumen.cheque)} sub="1 cuenta de cheques" delta={-8.4} />
              <Stat label="Total disponible" valor={montoTexto(resumen.total)} sub={`${resumen.activeAccounts} activas de ${resumen.accounts}`} destacado />
            </div>
          </div>
        </div>
        <AdminNote>
          `Stat` trae `label/valor/delta/sub/destacado`: `destacado` es una tarjeta de marca con degradado y `delta` es un
          porcentaje con flecha (en este ejemplo con un −8,4 % puesto solo para mostrar el widget). Nuestro `AdminKpi` no tiene
          tendencia ni variante destacada: lo usamos sin esos datos porque la app no calcula series históricas.
        </AdminNote>
      </AdminPanel>

      {/* ── Tabla real de cuentas ────────────────────────────────────────── */}
      <AdminPanel title="Cuentas de tesorería (datos reales de la demo)" icon="finance" meta="AdminTable vs DataTable">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual · AdminTable + AdminBadge + AdminButton</span>
            <AdminDataState
              loading={datos === null}
              empty={cuentas.length === 0}
              emptyTitle="Sin cuentas de tesorería"
              emptyIcon="wallet"
              rows={3}
            >
              <AdminTable
                view="tesoreria-cuentas"
                label="Cuentas de tesorería (panel actual)"
                columns={[
                  { label: "Cuenta" },
                  { label: "Tipo" },
                  { label: "Banco" },
                  { label: "Saldo inicial", end: true },
                  { label: "Saldo", end: true },
                  { label: "Estado" },
                  { label: "Acciones", end: true },
                ]}
              >
                {cuentas.map((cuenta) => (
                  <AdminRow key={cuenta.id}>
                    <AdminCell title={`Cuenta «${cuenta.name}» · ${cuenta.currency}`}>
                      <strong>{cuenta.name}</strong>
                    </AdminCell>
                    <AdminCell title={treasuryAccountTypeLabel(cuenta.type)}>
                      <AdminBadge tone={cuenta.type === "BANK" ? "info" : cuenta.type === "CHEQUE" ? "warn" : "ok"}>
                        {treasuryAccountTypeLabel(cuenta.type)}
                      </AdminBadge>
                    </AdminCell>
                    <AdminCell title={cuenta.bank ?? "Cuenta sin banco asociado"}>{cuenta.bank ?? "—"}</AdminCell>
                    <AdminCell end title={`Saldo inicial declarado: ${formatMoney(cuenta.openingBalance)}`}>
                      {formatMoney(cuenta.openingBalance)}
                    </AdminCell>
                    <AdminCell end title={`Saldo calculado: ${formatMoney(cuenta.balance)}`}>
                      <strong>{formatMoney(cuenta.balance)}</strong>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={cuenta.active ? "ok" : "neutral"}>{cuenta.active ? "Activa" : "Inactiva"}</AdminBadge>
                    </AdminCell>
                    <AdminCell end>
                      <span className="admin-actions">
                        <AdminButton icon="edit" title={`Editar cuenta: ${cuenta.name}`} aria-label={`Editar cuenta: ${cuenta.name}`} />
                      </span>
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            </AdminDataState>
          </div>

          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería · DataTable + Badge + ChipEstado + CeldaMoneda</span>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-3">
              <DataTable
                loading={datos === null}
                emptyLabel="Sin cuentas de tesorería"
                rows={cuentas}
                columns={[
                  { key: "name", label: "Cuenta", render: (cuenta) => <span className="font-semibold">{cuenta.name}</span> },
                  {
                    key: "type",
                    label: "Tipo",
                    render: (cuenta) => (
                      <Badge color={cuenta.type === "BANK" ? "blue" : cuenta.type === "CHEQUE" ? "orange" : "green"}>
                        {treasuryAccountTypeLabel(cuenta.type)}
                      </Badge>
                    ),
                  },
                  { key: "bank", label: "Banco", render: (cuenta) => <span className="text-mute">{cuenta.bank ?? "—"}</span> },
                  { key: "openingBalance", label: "Saldo inicial", align: "right", render: (cuenta) => <CeldaMoneda valor={cuenta.openingBalance} /> },
                  { key: "balance", label: "Saldo", align: "right", render: (cuenta) => <CeldaMoneda valor={cuenta.balance} className="text-fore" /> },
                  {
                    key: "active",
                    label: "Estado",
                    render: (cuenta) =>
                      cuenta.active ? <ChipEstado estado="pass" etiqueta="Activa" /> : <ChipEstado estado="pendiente" etiqueta="Inactiva" />,
                  },
                ]}
                mobileCard={(cuenta) => (
                  <div className="rounded-lg border border-ink-600 bg-ink-700/40 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{cuenta.name}</span>
                      <ChipEstado estado={cuenta.active ? "pass" : "pendiente"} etiqueta={cuenta.active ? "Activa" : "Inactiva"} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-mute">
                      <span>{treasuryAccountTypeLabel(cuenta.type)}</span>
                      <CeldaMoneda valor={cuenta.balance} className="text-fore" />
                    </div>
                  </div>
                )}
              />
            </div>
            <AdminNote>
              `DataTable` ya trae encabezado, filas, `loading` con `Skeleton` y tarjetas en mobile (`mobileCard`). No trae la
              plantilla de columnas del panel (`--&lt;vista&gt;-cols`) ni scroll horizontal silencioso; en mobile, sin
              `mobileCard`, cae a un `EmptyState` (no hay tabla apilada).
            </AdminNote>
          </div>
        </div>
        <AdminNote>
          Ancho: nuestra tabla de tesorería usa la plantilla del panel (`admin-table--tesoreria-cuentas`, mínimo 48 rem) y en media
          columna hace scroll horizontal; la de la librería se reparte con columnas elásticas. En mobile, `DataTable` dibuja las
          tarjetas de `mobileCard` y `AdminTable` mantiene el scroll horizontal.
        </AdminNote>
      </AdminPanel>

      {/* ── Constantes de celda ──────────────────────────────────────────── */}
      <AdminPanel title="Dato secundario en una fila" icon="audit" meta="admin-cell-sub vs CELDA_DATO / CELDA_NUMERO">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual · clases de celda del panel</span>
            <AdminTable
              view="tesoreria-cuentas"
              label="Cuentas (clases del panel)"
              columns={[
                { label: "Cuenta" },
                { label: "Dato secundario" },
                { label: "Saldo", end: true },
              ]}
            >
              {cuentas.map((cuenta) => (
                <AdminRow key={cuenta.id}>
                  <AdminCell title={cuenta.name}>
                    <strong>{cuenta.name}</strong>
                  </AdminCell>
                  <AdminCell title={cuenta.bank ?? "Sin banco"}>
                    <span className="admin-cell-sub">{cuenta.bank ?? "Sin banco"}</span>
                  </AdminCell>
                  <AdminCell end title={formatMoney(cuenta.balance)}>
                    {formatMoney(cuenta.balance)}
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          </div>
          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería · CELDA_ENCABEZADO / CELDA_DATO / CELDA_NUMERO</span>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-600">
                    <th className="px-2.5 py-1.5 text-left">
                      <span className={CELDA_ENCABEZADO}>Cuenta</span>
                    </th>
                    <th className="px-2.5 py-1.5 text-left">
                      <span className={CELDA_ENCABEZADO}>Dato secundario</span>
                    </th>
                    <th className="px-2.5 py-1.5 text-right">
                      <span className={CELDA_ENCABEZADO}>Saldo</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cuentas.map((cuenta) => (
                    <tr key={cuenta.id} className="border-b border-ink-600/60 last:border-0">
                      <td className="px-2.5 py-1.5">
                        <span className="truncate text-[13px] font-semibold">{cuenta.name}</span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className={CELDA_DATO}>{cuenta.bank ?? "Sin banco"}</span>
                      </td>
                      <td className={`px-2.5 py-1.5 ${CELDA_NUMERO}`}>
                        <Money value={cuenta.balance} className="font-semibold" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminNote>
              Las constantes de la librería son strings de Tailwind: sirven si la vista ya usa Tailwind. En LedBox el equivalente
              es `admin-cell` / `admin-cell-sub` / `admin-cell--end`; adoptarlas obliga a que la vista viva en Tailwind (o a un
              mapeo de clases en el shim).
            </AdminNote>
          </div>
        </div>
      </AdminPanel>

      {/* ── Vacíos, carga y error ────────────────────────────────────────── */}
      <AdminPanel title="Vacíos, carga y error" icon="info" meta="AdminEmpty vs EmptyState / Skeleton / ErrorState">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual</span>
            <div className="admin-panel">
              <AdminEmpty icon="wallet" title="Sin cuentas de tesorería" hint="Creá la primera cuenta (efectivo, banco o cheques)." />
            </div>
          </div>
          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería</span>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-2">
              <EmptyState icon="wallet" title="Sin cuentas de tesorería" description="Creá la primera cuenta (efectivo, banco o cheques)." />
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-2">
              <EmptyState compact icon="filter" title="Sin resultados con este filtro" />
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-8 w-full" />
              <Skeleton className="mt-2 h-8 w-full" />
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-2">
              <ErrorState title="No pudimos leer la tesorería" description="Reintentá la lectura; si sigue igual, revisá la conexión." />
            </div>
          </div>
        </div>
      </AdminPanel>

      {/* ── Formatos ─────────────────────────────────────────────────────── */}
      <AdminPanel title="Montos y fechas" icon="clock" meta="formatMoney/formatDate vs montoTexto/formatGs/fechaDia">
        <PilotoFormatos total={resumen.total} />
        <AdminNote>
          Mismo número, distinto prefijo: LedBox dibuja «Gs. 18.994.000» y la librería «Gs 18.994.000». Las fechas de la
          librería usan el huso del navegador; las del panel fijan America/Asuncion (regla del repo). Las dos cosas se resuelven
          parametrizando la librería (moneda/locale/huso) o dejando los formateadores del panel.
        </AdminNote>
      </AdminPanel>

      <PilotoControles cuentas={cuentas} total={resumen.total} />
    </div>
  );
}

/** Fechas y montos: mismos valores de entrada, dos formateadores. */
function PilotoFormatos({ total, fecha = FECHA_MUESTRA }: { total: number; fecha?: string }) {
  const filas: Array<{ dato: string; panel: string; libreria: string; nota: string }> = [
    { dato: "Monto PYG", panel: formatMoney(total), libreria: montoTexto(total), nota: "la librería omite el punto de «Gs.»" },
    { dato: "Monto grande", panel: formatMoney(99_000_000), libreria: formatGs(99_000_000), nota: "sin decimales en ambos" },
    { dato: "Cantidad", panel: formatNumber(1234), libreria: new Intl.NumberFormat("es-PY").format(1234), nota: "la librería no expone formato de enteros" },
    { dato: "Fecha", panel: formatDate(fecha), libreria: fechaDia(fecha), nota: "la librería usa el huso del navegador" },
    { dato: "Fecha y hora", panel: formatDateTime(fecha), libreria: fechaHora(fecha), nota: "24 h en ambos; cambia el orden" },
    { dato: "Fecha corta", panel: formatDate(fecha), libreria: fechaCorta(fecha), nota: "mismo día, distinto separador y formato" },
  ];
  return (
    <AdminTable
      view="piloto-formatos"
      label="Formatos de montos y fechas"
      columns={[{ label: "Dato" }, { label: "Panel actual" }, { label: "Librería" }, { label: "Diferencia" }]}
    >
      {filas.map((fila) => (
        <AdminRow key={fila.dato}>
          <AdminCell title={fila.dato}>
            <strong>{fila.dato}</strong>
          </AdminCell>
          <AdminCell title={fila.panel}>{fila.panel}</AdminCell>
          <AdminCell title={fila.libreria}>{fila.libreria}</AdminCell>
          <AdminCell title={fila.nota}>
            <span className="admin-cell-sub">{fila.nota}</span>
          </AdminCell>
        </AdminRow>
      ))}
    </AdminTable>
  );
}
