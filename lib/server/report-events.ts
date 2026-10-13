import { db } from "./db";
import { live } from "./trash-filter";

/**
 * Eventos del reporte mensual (dinero). `deletedAt: undefined` hace que la extensión de
 * `db` NO oculte los eventos eliminados: sus cobros y facturas siguen en otras secciones
 * del reporte, así que la venta y el margen tienen que seguir contándolos. Se rotulan
 * «(eliminado)» donde se muestra el nombre. Las listas operativas no usan esto.
 */
export async function loadMonthlyReportEvents(organizationId: string, start: Date, end: Date, lostStatuses: ReadonlyArray<string>) {
  const events = await db.event.findMany({
    where: { organizationId, deletedAt: undefined, startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: "asc" },
    include: {
      client: true,
      budgets: { where: { ...live, status: { notIn: [...lostStatuses] as never } } },
      supplierJobs: { select: { id: true, total: true } },
    },
  });
  return events.map((event) => ({ ...event, displayName: event.deletedAt ? `${event.name} (eliminado)` : event.name }));
}
