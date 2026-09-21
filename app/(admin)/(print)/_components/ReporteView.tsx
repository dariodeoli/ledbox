"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { formatCalendarMonth, formatMoney, formatNumber } from "@/lib/admin-format";
import { downloadCsv, type CsvBlock } from "@/lib/admin-export";
import type { AdminMonthlyReport } from "@/lib/admin-types";
import { PrintEmpty, PrintFooter, PrintHeader, PrintSection } from "./PrintParts";
import { PrintToolbar } from "./PrintToolbar";

/** Meses ofrecidos por el selector: el actual y los 23 anteriores. */
function monthOptions(current: string): string[] {
  const [year, month] = current.split("-").map(Number);
  return Array.from({ length: 24 }, (_, index) => {
    const total = year * 12 + (month - 1) - index;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  });
}

function totalRow(label: string, value: number): CsvBlock["rows"][number] {
  return [label, "", "", "", "", value];
}

/**
 * Reporte mensual imprimible + CSV. La hoja y el archivo salen del mismo modelo
 * (datos reales del período resueltos server-side en la página).
 */
export function ReporteView({ report }: { report: AdminMonthlyReport }) {
  const router = useRouter();
  const months = useMemo(() => monthOptions(report.month), [report.month]);
  const periodLabel = `Período: ${report.monthLabel}`;

  function exportCsv() {
    const blocks: CsvBlock[] = [
      {
        title: `Reporte mensual · ${report.monthLabel}`,
        header: ["Concepto", "Valor", "", "", "", ""],
        rows: [
          ["Empresa", report.organization],
          ["Período", report.month],
          ["Emitido", report.issuedAt],
          ["Eventos en el período", report.totals.events],
          ["Venta (presupuestos vigentes)", report.totals.sale],
          ["Costos estimados", report.totals.costEstimate],
          ["Margen simple", report.totals.margin ?? ""],
          ["Cobrado a clientes", report.totals.collected],
          ["Pagado a proveedores", report.totals.paidToSuppliers],
          ["Saldo comprometido con proveedores", report.totals.committedBalance],
        ],
      },
      {
        title: "Eventos del período",
        header: ["Fecha", "Evento", "Cliente", "Lugar", "Venta", "Costos estimados", "Margen", "Trabajos de proveedor", "Total proveedores"],
        rows: report.events.map((row) => [
          row.date,
          row.name,
          row.client,
          row.location ?? "",
          row.sale,
          row.costEstimate,
          row.margin ?? "",
          row.supplierJobs,
          row.supplierTotal,
        ]),
      },
      {
        title: "Cobros de clientes",
        header: ["Fecha", "Cliente", "Presupuesto", "Método", "Referencia", "Monto"],
        rows: [
          ...report.collections.map((row) => [row.date, row.client, row.budget ?? "", row.method ?? "", row.reference ?? "", row.amount]),
          totalRow("Total cobrado", report.totals.collected),
        ],
      },
      {
        title: "Pagos a proveedores (pagados en el período)",
        header: ["Fecha de pago", "Proveedor", "Trabajo", "Evento", "Método", "Comprobante", "Total"],
        rows: report.supplierPayments.map((row) => [
          row.date,
          row.supplier,
          row.description,
          row.event ?? "",
          row.method ?? "",
          row.receipt ?? "",
          row.amount,
        ]),
      },
      {
        title: "Cuentas por pagar (vencen en el período)",
        header: ["Vence", "Proveedor", "Trabajo", "Evento", "Estado", "Total", "Anticipo", "Saldo"],
        rows: [
          ...report.supplierPending.map((row) => [
            row.dueDate,
            row.supplier,
            row.description,
            row.event ?? "",
            row.status,
            row.total,
            row.advance,
            row.balance,
          ]),
          ["Total", "", "", "", "", "", "", report.totals.committedBalance],
        ],
      },
    ];
    downloadCsv(`ledbox-reporte-${report.month}.csv`, blocks);
  }

  return (
    <>
      <PrintToolbar backHref="/finanzas" backLabel="Volver a Finanzas">
        <label className="lbprint-select-wrap">
          <span className="lbprint-label">Mes del reporte</span>
          <select
            className="lbprint-select"
            value={report.month}
            title="Elegir el mes del reporte"
            aria-label="Elegir el mes del reporte"
            onChange={(event) => router.push(`/imprimir/reporte?mes=${event.target.value}`)}
          >
            {months.map((month) => (
              <option key={month} value={month}>
                {formatCalendarMonth(`${month}-01`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="lbprint-btn"
          onClick={exportCsv}
          title="Descargar el reporte en CSV"
          aria-label="Descargar el reporte en CSV"
        >
          <AdminIcon name="download" size={15} />
          <span>Descargar CSV</span>
        </button>
      </PrintToolbar>

      <article className="lbprint-sheet" aria-label={`Reporte mensual ${report.monthLabel}`}>
        <PrintHeader
          title="Reporte mensual"
          reference={report.monthLabel}
          organization={report.organization}
          issuedAt={report.issuedAt}
          meta={periodLabel}
        />

        <section className="lbprint-kpis" aria-label="Resumen del período">
          <div className="lbprint-kpi">
            <span className="lbprint-kpi-label">Eventos en el período</span>
            <strong className="lbprint-kpi-value">{formatNumber(report.totals.events)}</strong>
            <span className="lbprint-kpi-note">con inicio en el mes</span>
          </div>
          <div className="lbprint-kpi">
            <span className="lbprint-kpi-label">Venta presupuestada</span>
            <strong className="lbprint-kpi-value">{formatMoney(report.totals.sale)}</strong>
            <span className="lbprint-kpi-note">presupuestos vigentes</span>
          </div>
          <div className="lbprint-kpi">
            <span className="lbprint-kpi-label">Cobrado a clientes</span>
            <strong className="lbprint-kpi-value">{formatMoney(report.totals.collected)}</strong>
            <span className="lbprint-kpi-note">{formatNumber(report.collections.length)} cobros</span>
          </div>
          <div className="lbprint-kpi">
            <span className="lbprint-kpi-label">Pagado a proveedores</span>
            <strong className="lbprint-kpi-value">{formatMoney(report.totals.paidToSuppliers)}</strong>
            <span className="lbprint-kpi-note">{formatNumber(report.supplierPayments.length)} trabajos</span>
          </div>
          <div className="lbprint-kpi">
            <span className="lbprint-kpi-label">Margen simple</span>
            <strong className="lbprint-kpi-value">
              {report.totals.margin === null ? "—" : formatMoney(report.totals.margin)}
            </strong>
            <span className="lbprint-kpi-note">
              {report.totals.margin === null ? "sin costos estimados cargados" : "venta − costos estimados"}
            </span>
          </div>
          <div className="lbprint-kpi">
            <span className="lbprint-kpi-label">Saldo comprometido</span>
            <strong className="lbprint-kpi-value">{formatMoney(report.totals.committedBalance)}</strong>
            <span className="lbprint-kpi-note">proveedores que vencen en el mes</span>
          </div>
        </section>

        <PrintSection title="Rentabilidad simple por evento">
          {report.events.length === 0 ? (
            <PrintEmpty>No hay eventos con inicio en el período.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Inicio</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Lugar</th>
                  <th scope="col" className="lbprint-num">
                    Venta
                  </th>
                  <th scope="col" className="lbprint-num">
                    Costos estimados
                  </th>
                  <th scope="col" className="lbprint-num">
                    Margen
                  </th>
                  <th scope="col" className="lbprint-num">
                    Proveedores
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.events.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.name}</td>
                    <td>{row.client}</td>
                    <td>{row.location || "—"}</td>
                    <td className="lbprint-num">{formatMoney(row.sale)}</td>
                    <td className="lbprint-num">{formatMoney(row.costEstimate)}</td>
                    <td className="lbprint-num">{row.margin === null ? "Sin costos" : formatMoney(row.margin)}</td>
                    <td className="lbprint-num">
                      {row.supplierJobs > 0 ? `${formatNumber(row.supplierJobs)} · ${formatMoney(row.supplierTotal)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Totales del período</td>
                  <td className="lbprint-num">{formatMoney(report.totals.sale)}</td>
                  <td className="lbprint-num">{formatMoney(report.totals.costEstimate)}</td>
                  <td className="lbprint-num">
                    {report.totals.margin === null ? "Sin costos" : formatMoney(report.totals.margin)}
                  </td>
                  <td className="lbprint-num">—</td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="lbprint-note">
            Venta = presupuestos vigentes del evento (sin perdidos ni cancelados). El margen se muestra solo en los eventos con
            costos estimados cargados; los proveedores muestran los trabajos contratados contra el evento.
          </p>
        </PrintSection>

        <PrintSection title="Cobros de clientes">
          {report.collections.length === 0 ? (
            <PrintEmpty>No hay cobros registrados en el período.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Presupuesto</th>
                  <th scope="col">Método</th>
                  <th scope="col">Referencia</th>
                  <th scope="col" className="lbprint-num">
                    Monto
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.collections.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.client}</td>
                    <td>{row.budget || "—"}</td>
                    <td>{row.method || "—"}</td>
                    <td>{row.reference || "—"}</td>
                    <td className="lbprint-num">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total cobrado</td>
                  <td className="lbprint-num">{formatMoney(report.totals.collected)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Pagos a proveedores">
          {report.supplierPayments.length === 0 ? (
            <PrintEmpty>No hay trabajos de proveedor pagados en el período.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Fecha de pago</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Trabajo</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Método</th>
                  <th scope="col">Comprobante</th>
                  <th scope="col" className="lbprint-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.supplierPayments.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.supplier}</td>
                    <td>{row.description}</td>
                    <td>{row.event || "—"}</td>
                    <td>{row.method || "—"}</td>
                    <td>{row.receipt || "—"}</td>
                    <td className="lbprint-num">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>Total pagado</td>
                  <td className="lbprint-num">{formatMoney(report.totals.paidToSuppliers)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Cuentas por pagar del período">
          {report.supplierPending.length === 0 ? (
            <PrintEmpty>No hay trabajos de proveedor con vencimiento en el período.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Vence</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Trabajo</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="lbprint-num">
                    Total
                  </th>
                  <th scope="col" className="lbprint-num">
                    Anticipo
                  </th>
                  <th scope="col" className="lbprint-num">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.supplierPending.map((row) => (
                  <tr key={row.id}>
                    <td>{row.dueDate}</td>
                    <td>{row.supplier}</td>
                    <td>{row.description}</td>
                    <td>{row.event || "—"}</td>
                    <td>{row.status}</td>
                    <td className="lbprint-num">{formatMoney(row.total)}</td>
                    <td className="lbprint-num">{formatMoney(row.advance)}</td>
                    <td className="lbprint-num">{formatMoney(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>Saldo comprometido</td>
                  <td className="lbprint-num">{formatMoney(report.totals.committedBalance)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="lbprint-note">
            Los pagos son trabajos con fecha de pago dentro del período; las cuentas por pagar son trabajos abiertos que vencen
            en el período (saldo = total − anticipo).
          </p>
        </PrintSection>

        <PrintFooter note={`Reporte mensual · ${report.monthLabel}`} />
      </article>
    </>
  );
}
