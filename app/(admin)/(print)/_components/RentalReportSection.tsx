import { formatMoney, formatNumber } from "@/lib/admin-format";
import type { CsvBlock } from "@/lib/admin-export";
import type { AdminRentalReport } from "@/lib/admin-types";
import { PrintEmpty, PrintSection } from "./PrintParts";

const KIND_LABEL: Record<string, string> = { DAMAGE: "Daño", MISSING: "Faltante", REPAIR: "Reparación", CLEANING: "Limpieza" };
const INCIDENT_STATUS_LABEL: Record<string, string> = { OPEN: "Abierto", IN_REPAIR: "En reparación", RESOLVED: "Resuelto", WRITTEN_OFF: "Dado de baja" };
const GUARANTEE_LABEL: Record<string, string> = {
  PENDING: "Pendiente de recibir",
  HELD: "En custodia",
  RETURNED: "Devuelta",
  KEPT_PARTIAL: "Retenida en parte",
  KEPT: "Retenida",
};
const BUDGET_STATUS_LABEL: Record<string, string> = { LOST: "Perdido", CANCELLED: "Cancelado" };

/** Sin dato nunca se muestra como 0. */
export const NO_DATA = "sin dato";
const money = (value: number | null) => (value === null ? NO_DATA : formatMoney(value));
const percent = (value: number | null) => (value === null ? "—" : `${String(value).replace(".", ",")} %`);
const days = (value: number) => String(value).replace(".", ",");

/** Costo conocido + aviso de los incidentes que no lo tienen cargado. */
export function costLabel(known: number | null, unknown: number): string {
  if (known === null) return NO_DATA;
  return unknown > 0 ? `${formatMoney(known)} + ${formatNumber(unknown)} sin dato` : formatMoney(known);
}

export function rentalCsvBlocks(rentals: AdminRentalReport): CsvBlock[] {
  const occ = (title: string, rows: AdminRentalReport["occupancy"]["top"]): CsvBlock => ({
    title,
    header: ["Producto", "Días-unidad comprometidos", "Días-unidad disponibles", "Ocupación %"],
    rows: rows.map((row) => [row.name, row.committedDays, row.availableDays, row.percent]),
  });
  const blocks: CsvBlock[] = [
    occ("Alquileres · productos más usados", rentals.occupancy.top),
    occ("Alquileres · productos menos usados", rentals.occupancy.least),
    {
      title: "Alquileres · conversión del catálogo",
      header: ["Concepto", "Valor"],
      rows: [
        ["Pedidos recibidos", rentals.catalog.received],
        ["Convertidos", rentals.catalog.converted],
        ["Declinados", rentals.catalog.declined],
        ["Vencidos", rentals.catalog.expired],
        ["En curso", rentals.catalog.open],
        ["Tasa de conversión %", rentals.catalog.conversionRate ?? ""],
      ],
    },
    {
      title: "Alquileres · cancelaciones",
      header: ["Concepto", "Valor"],
      rows: [
        ["Eventos cancelados", rentals.cancellations.events.count],
        ["Presupuestos perdidos", rentals.cancellations.budgets.lost],
        ["Presupuestos cancelados", rentals.cancellations.budgets.cancelled],
        ["Monto de presupuestos perdidos o cancelados", rentals.cancellations.budgets.amount],
      ],
    },
    {
      title: "Alquileres · daños y faltantes",
      header: ["Tipo", "Estado", "Incidentes", "Unidades", "Costo de reparación conocido", "Incidentes sin costo"],
      rows: rentals.incidents.rows.map((row) => [
        KIND_LABEL[row.kind] ?? row.kind,
        INCIDENT_STATUS_LABEL[row.status] ?? row.status,
        row.count,
        row.quantity,
        row.knownCost ?? NO_DATA,
        row.unknownCostCount,
      ]),
    },
    {
      title: "Alquileres · señas y garantías",
      header: ["Concepto", "Cantidad", "Monto", "Retenido", "Devuelto"],
      rows: [
        ["Señas cobradas", rentals.deposits.advances.count, rentals.deposits.advances.collected, "", ""],
        ["Señas pendientes", "", rentals.deposits.advances.pending, "", ""],
        ...rentals.deposits.guarantees.map((row) => [`Garantía · ${GUARANTEE_LABEL[row.status] ?? row.status}`, row.count, row.amount, row.retained, row.returned]),
      ],
    },
  ];
  if (rentals.profitability) {
    blocks.push({
      title: "Alquileres · rentabilidad estimada por producto",
      header: ["Producto", "Ingresos", "Costo de incidentes", "Incidentes sin costo", "Resultado"],
      rows: rentals.profitability.rows.map((row) => [row.name, row.revenue, row.incidentCost ?? NO_DATA, row.unknownCostCount, row.net]),
    });
  }
  return blocks;
}

function OccupancyTable({ rows, empty }: { rows: AdminRentalReport["occupancy"]["top"]; empty: string }) {
  if (rows.length === 0) return <PrintEmpty>{empty}</PrintEmpty>;
  return (
    <table className="lbprint-table">
      <thead>
        <tr>
          <th scope="col">Producto</th>
          <th scope="col" className="lbprint-num">Comprometidos</th>
          <th scope="col" className="lbprint-num">Disponibles</th>
          <th scope="col" className="lbprint-num">Ocupación</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td className="lbprint-num">{days(row.committedDays)} d-u</td>
            <td className="lbprint-num">{days(row.availableDays)} d-u</td>
            <td className="lbprint-num">{percent(row.percent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Sección «Alquileres» del reporte mensual: sólo presentación de datos reales ya resueltos en el servidor. */
export function RentalReportSection({ rentals, periodLabel }: { rentals: AdminRentalReport; periodLabel: string }) {
  const { catalog, cancellations, incidents, deposits, profitability, occupancy } = rentals;
  return (
    <>
      <PrintSection title={`Alquileres · ocupación por producto (${periodLabel})`}>
        {occupancy.truncated ? <p className="lbprint-subtitle">El período tiene más movimientos de los que entran en este reporte: la ocupación es parcial. Elegí un mes con menos actividad o pedí el detalle.</p> : null}
        <h3 className="lbprint-subtitle">Los 10 más usados</h3>
        <OccupancyTable rows={occupancy.top} empty="Ningún producto tuvo unidades comprometidas en el período." />
        <h3 className="lbprint-subtitle">Los menos usados</h3>
        <OccupancyTable
          rows={occupancy.least}
          empty={occupancy.rankedItems <= occupancy.top.length ? "Todos los productos con uso ya figuran arriba." : "No hay otros productos alquilables para comparar."}
        />
        <p className="lbprint-note">
          Ocupación = días-unidad (24 h) comprometidos ÷ días-unidad disponibles del período. Usa la misma regla que la disponibilidad:
          rango del evento más tiempos de preparación, transporte, entrega, devolución y limpieza; las retenciones vencidas y las asignaciones
          liberadas no cuentan; las unidades dañadas, perdidas o en mantenimiento hoy se descuentan del disponible. Solo productos alquilables
          (no combos ni consumibles); los componentes de un combo cuentan en su propio producto.
        </p>
      </PrintSection>

      <PrintSection title="Alquileres · conversión del catálogo">
        {catalog.received === 0 ? (
          <PrintEmpty>No llegaron pedidos del catálogo en el período.</PrintEmpty>
        ) : (
          <table className="lbprint-table">
            <thead>
              <tr>
                <th scope="col">Pedidos recibidos</th>
                <th scope="col" className="lbprint-num">Convertidos</th>
                <th scope="col" className="lbprint-num">Declinados</th>
                <th scope="col" className="lbprint-num">Vencidos</th>
                <th scope="col" className="lbprint-num">En curso</th>
                <th scope="col" className="lbprint-num">Tasa de conversión</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatNumber(catalog.received)}</td>
                <td className="lbprint-num">{formatNumber(catalog.converted)}</td>
                <td className="lbprint-num">{formatNumber(catalog.declined)}</td>
                <td className="lbprint-num">{formatNumber(catalog.expired)}</td>
                <td className="lbprint-num">{formatNumber(catalog.open)}</td>
                <td className="lbprint-num">{percent(catalog.conversionRate)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="lbprint-note">
          Pedidos creados en el período. Vencido = marcado como vencido o sin responder pasado el plazo prometido. Tasa = convertidos ÷ recibidos.
        </p>
      </PrintSection>

      <PrintSection title="Alquileres · cancelaciones">
        {cancellations.events.count === 0 && cancellations.budgets.rows.length === 0 ? (
          <PrintEmpty>No hubo eventos cancelados ni presupuestos perdidos o cancelados en el período.</PrintEmpty>
        ) : (
          <>
            <p className="lbprint-note">
              {formatNumber(cancellations.events.count)} evento(s) cancelado(s) · {formatNumber(cancellations.budgets.lost)} presupuesto(s) perdido(s) ·{" "}
              {formatNumber(cancellations.budgets.cancelled)} cancelado(s) · {formatMoney(cancellations.budgets.amount)} en presupuestos.
            </p>
            {cancellations.events.rows.length > 0 ? (
              <table className="lbprint-table">
                <thead>
                  <tr>
                    <th scope="col">Evento cancelado</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Inicio previsto</th>
                  </tr>
                </thead>
                <tbody>
                  {cancellations.events.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.client}</td>
                      <td>{row.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {cancellations.budgets.rows.length > 0 ? (
              <table className="lbprint-table">
                <thead>
                  <tr>
                    <th scope="col">Presupuesto</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="lbprint-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cancellations.budgets.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.title}</td>
                      <td>{row.client}</td>
                      <td>{BUDGET_STATUS_LABEL[row.status] ?? row.status}</td>
                      <td className="lbprint-num">{formatMoney(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}
        <p className="lbprint-note">
          Eventos cancelados con inicio en el período; presupuestos perdidos o cancelados con última modificación en el período (el evento y su presupuesto pueden figurar los dos). Se listan hasta 10 de cada uno.
        </p>
      </PrintSection>

      <PrintSection title="Alquileres · daños y faltantes">
        {incidents.total === 0 ? (
          <PrintEmpty>No se abrieron incidentes de inventario en el período.</PrintEmpty>
        ) : (
          <table className="lbprint-table">
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Estado</th>
                <th scope="col" className="lbprint-num">Incidentes</th>
                <th scope="col" className="lbprint-num">Unidades</th>
                <th scope="col" className="lbprint-num">Costo de reparación</th>
              </tr>
            </thead>
            <tbody>
              {incidents.rows.map((row) => (
                <tr key={`${row.kind}-${row.status}`}>
                  <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td>{INCIDENT_STATUS_LABEL[row.status] ?? row.status}</td>
                  <td className="lbprint-num">{formatNumber(row.count)}</td>
                  <td className="lbprint-num">{formatNumber(row.quantity)}</td>
                  <td className="lbprint-num">{costLabel(row.knownCost, row.unknownCostCount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="lbprint-num">{formatNumber(incidents.total)}</td>
                <td className="lbprint-num">—</td>
                <td className="lbprint-num">{costLabel(incidents.knownCost, incidents.unknownCostCount)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="lbprint-note">Incidentes abiertos en el período. El costo suma solo los incidentes con costo cargado; los demás figuran como «sin dato», nunca como 0.</p>
      </PrintSection>

      <PrintSection title="Alquileres · señas y garantías">
        <table className="lbprint-table">
          <thead>
            <tr>
              <th scope="col">Señas del período</th>
              <th scope="col" className="lbprint-num">Cobrado</th>
              <th scope="col" className="lbprint-num">Pendiente</th>
              <th scope="col" className="lbprint-num">Comprobante en revisión</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{formatNumber(deposits.advances.count)} seña(s)</td>
              <td className="lbprint-num">{formatMoney(deposits.advances.collected)}</td>
              <td className="lbprint-num">{formatMoney(deposits.advances.pending)}</td>
              <td className="lbprint-num">{formatMoney(deposits.advances.proofInReview)}</td>
            </tr>
          </tbody>
        </table>
        {deposits.guarantees.length === 0 ? (
          <PrintEmpty>No hay garantías de alquiler en el período.</PrintEmpty>
        ) : (
          <table className="lbprint-table">
            <thead>
              <tr>
                <th scope="col">Garantía</th>
                <th scope="col" className="lbprint-num">Presupuestos</th>
                <th scope="col" className="lbprint-num">Monto</th>
                <th scope="col" className="lbprint-num">Retenido</th>
                <th scope="col" className="lbprint-num">Devuelto</th>
              </tr>
            </thead>
            <tbody>
              {deposits.guarantees.map((row) => (
                <tr key={row.status}>
                  <td>{GUARANTEE_LABEL[row.status] ?? row.status}</td>
                  <td className="lbprint-num">{formatNumber(row.count)}</td>
                  <td className="lbprint-num">{formatMoney(row.amount)}</td>
                  <td className="lbprint-num">{formatMoney(row.retained)}</td>
                  <td className="lbprint-num">{formatMoney(row.returned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="lbprint-note">
          Señas = anticipo del plan de pagos con vencimiento en el período (o alta en el período si no tiene vencimiento); lo pendiente excluye presupuestos perdidos o cancelados. Garantías de presupuestos cuyo evento empieza en el período (o creados en él si no hay evento); van aparte del total y no cuentan como cobro.
        </p>
      </PrintSection>

      {profitability ? (
        <PrintSection title="Alquileres · rentabilidad estimada por producto">
          <table className="lbprint-table">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="lbprint-num">Ingresos</th>
                <th scope="col" className="lbprint-num">Costo de incidentes</th>
                <th scope="col" className="lbprint-num">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {profitability.rows.map((row) => (
                <tr key={row.inventoryId}>
                  <td>{row.name}</td>
                  <td className="lbprint-num">{formatMoney(row.revenue)}</td>
                  <td className="lbprint-num">{costLabel(row.incidentCost, row.unknownCostCount)}</td>
                  <td className="lbprint-num">{formatMoney(row.net)}{row.unknownCostCount > 0 ? " (parcial)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lbprint-note">
            Criterio: ingresos = subtotal de las líneas vinculadas a un producto en presupuestos aprobados en el período (antes de descuentos globales); costo = incidentes del producto abiertos en el período con costo cargado. No incluye costos de proveedores, amortización ni impuestos; es una estimación.
          </p>
        </PrintSection>
      ) : null}
    </>
  );
}
