import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  damageSummary,
  eventStatusLabel,
  formatDate,
  formatDateTime,
  formatNumber,
  inventoryAssignmentState,
  taskTypeLabel,
} from "@/lib/admin-format";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { loadOrganizationLogos } from "@/lib/server/branding";
import { organizationLogoUrl } from "@/lib/admin-types";
import { PrintEmpty, PrintField, PrintFooter, PrintHeader, PrintSection } from "../../../_components/PrintParts";
import { PrintToolbar } from "../../../_components/PrintToolbar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orden de trabajo", robots: { index: false, follow: false } };

function shortReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Rango asignado en una línea: `09-oct. 08:00 → 12-oct. 20:00`. */
function rangeLabel(start: Date | null, end: Date | null): string {
  if (!start && !end) return "Sin fechas";
  if (start && end) return `${formatDateTime(start)} → ${formatDateTime(end)}`;
  return formatDateTime(start ?? end);
}

function stamp(value: Date | null): string {
  return value ? formatDateTime(value) : "—";
}

/**
 * Orden de trabajo imprimible del evento (PDF vía `window.print()`):
 * datos del evento y del cliente, equipos asignados y checklist operativo.
 */
export default async function EventoImprimiblePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) redirect("/login");
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: {
      client: true,
      assignments: { include: { inventory: true }, orderBy: { startsAt: "asc" } },
      tasks: { orderBy: [{ dueAt: "asc" }, { title: "asc" }] },
    },
  });
  if (!event) notFound();

  const reference = `OT Nº ${shortReference(event.id)}`;
  const doneTasks = event.tasks.filter((task) => task.completedAt).length;
  // En papel siempre el logo claro (issue #22); sin logo queda el monograma LB.
  const logos = await loadOrganizationLogos(auth.context.organizationId);
  const logo = logos.light ? organizationLogoUrl("light", logos.light.updatedAt) : null;

  return (
    <>
      <PrintToolbar backHref="/eventos" backLabel="Volver a Eventos" />

      <article className="lbprint-sheet" aria-label={`Orden de trabajo ${event.name}`}>
        <PrintHeader
          title="Orden de trabajo"
          reference={reference}
          organization={auth.context.organization.name}
          issuedAt={formatDateTime(new Date())}
          meta={`Estado: ${eventStatusLabel(event.status)}`}
          logo={logo}
        />

        <PrintSection title="Evento">
          <div className="lbprint-grid">
            <PrintField label="Nombre" value={event.name} />
            <PrintField label="Lugar" value={event.location || "Sin lugar definido"} />
            <PrintField label="Montaje" value={event.setupAt ? formatDateTime(event.setupAt) : "—"} />
            <PrintField label="Inicio" value={event.startsAt ? formatDateTime(event.startsAt) : "A confirmar"} />
            <PrintField label="Fin" value={event.endsAt ? formatDateTime(event.endsAt) : "—"} />
            <PrintField label="Desmontaje" value={event.strikeAt ? formatDateTime(event.strikeAt) : "—"} />
            <PrintField label="Notas" value={event.notes || "Sin notas."} wide />
          </div>
        </PrintSection>

        <PrintSection title="Cliente">
          <div className="lbprint-grid">
            <PrintField label="Razón social" value={event.client.company || event.client.name} />
            <PrintField label="Contacto" value={event.client.company ? event.client.name : "—"} />
            <PrintField label="RUC" value={event.client.ruc || "—"} />
            <PrintField label="Teléfono" value={event.client.phone || "—"} />
            <PrintField label="Correo" value={event.client.email || "—"} wide />
          </div>
        </PrintSection>

        <PrintSection
          title="Equipos asignados"
          action={
            event.assignments.length > 0
              ? `${formatNumber(event.assignments.length)} asignaciones · ${formatNumber(
                  event.assignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
                )} unidades`
              : null
          }
        >
          {event.assignments.length === 0 ? (
            <PrintEmpty>Sin equipos asignados a este evento.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Artículo</th>
                  <th scope="col">SKU</th>
                  <th scope="col" className="lbprint-num">
                    Cantidad
                  </th>
                  <th scope="col">Rango asignado</th>
                  <th scope="col">Salida</th>
                  <th scope="col">Devolución</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Daños</th>
                </tr>
              </thead>
              <tbody>
                {event.assignments.map((assignment) => {
                  const state = inventoryAssignmentState(assignment);
                  const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
                  const start = assignment.startsAt ?? event.setupAt ?? event.startsAt;
                  const end = assignment.endsAt ?? event.strikeAt ?? event.endsAt ?? start;
                  return (
                    <tr key={assignment.id}>
                      <td>{assignment.inventory.name}</td>
                      <td>{assignment.inventory.sku || "—"}</td>
                      <td className="lbprint-num">{formatNumber(assignment.quantity)}</td>
                      <td>{rangeLabel(start, end)}</td>
                      <td>{stamp(assignment.checkedOutAt)}</td>
                      <td>{stamp(assignment.checkedInAt)}</td>
                      <td>{state.label}</td>
                      <td>{damages || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </PrintSection>

        <PrintSection
          title="Checklist operativo"
          action={
            event.tasks.length > 0 ? `${formatNumber(doneTasks)} de ${formatNumber(event.tasks.length)} cumplidas` : null
          }
        >
          {event.tasks.length === 0 ? (
            <PrintEmpty>Sin tareas cargadas para este evento.</PrintEmpty>
          ) : (
            <table className="lbprint-table">
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Tarea</th>
                  <th scope="col">Vence</th>
                  <th scope="col">Completada</th>
                </tr>
              </thead>
              <tbody>
                {event.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{taskTypeLabel(task.type)}</td>
                    <td>{task.title}</td>
                    <td>{task.dueAt ? formatDate(task.dueAt) : "—"}</td>
                    <td>{task.completedAt ? formatDateTime(task.completedAt) : "Pendiente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Firmas">
          <div className="lbprint-sign">
            <span className="lbprint-sign-box">Responsable de montaje</span>
            <span className="lbprint-sign-box">Responsable de desmontaje</span>
            <span className="lbprint-sign-box">Conformidad del cliente</span>
          </div>
        </PrintSection>

        <PrintFooter note={`${reference} · ${event.name}`} />
      </article>
    </>
  );
}
