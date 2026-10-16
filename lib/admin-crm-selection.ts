import type { AdminClientRow, AdminPromoterRow, AdminSupplierRow } from "./admin-types";
import { matchesQuery } from "./admin-policy";
import { clientDisplayName, clientLegalName, clientPresentation } from "./client-identity";
import { matchesKpi, type ClientKpiKey, type ClientSegment } from "./client-portfolio";
import type { BulkTrashRow } from "./bulk-trash";

/** Mismo alcance para lo visible y «todos los filtrados», sin depender del límite de la primera página. */
export function filterClientSelection(rows: AdminClientRow[], scope: { query: string; segment: ClientSegment; kpi: ClientKpiKey | null; filter: string }): AdminClientRow[] {
  const { query, segment, kpi, filter } = scope;
  const owing = kpi === "BALANCE" || filter === "OVERDUE";
  return rows.filter((client) => {
    if (filter === "ARCHIVED" ? !client.archivedAt : !owing && client.archivedAt) return false;
    if (segment !== "ALL" && client.type !== segment) return false;
    if (kpi && !matchesKpi(client, kpi)) return false;
    if (filter === "NO_RESPONSIBLE" && client.contactName) return false;
    if (filter === "OVERDUE" && client.metrics.overdue <= 0) return false;
    if (filter === "NO_PURCHASES" && client.metrics.contracts !== 0) return false;
    return matchesQuery(query, [client.name, clientDisplayName(client), clientLegalName(client), client.company, client.ruc, client.email, client.phone, client.contactName, client.contactEmail, client.contactPhone, client.billingEmail, client.whatsapp]);
  });
}

export function filterSupplierSelection(rows: AdminSupplierRow[], scope: { query: string; supplierScope: string }): AdminSupplierRow[] {
  return rows.filter((supplier) => (scope.supplierScope === "ARCHIVED" ? Boolean(supplier.archivedAt) : !supplier.archivedAt) && matchesQuery(scope.query, [supplier.name, supplier.company, supplier.category, supplier.phone, supplier.email]));
}

export function filterPromoterSelection(rows: AdminPromoterRow[], scope: { query: string; availabilityFilter: string }): AdminPromoterRow[] {
  const archived = scope.availabilityFilter === "ARCHIVED";
  return rows.filter((promoter) => Boolean(promoter.archivedAt) === archived && (scope.availabilityFilter === "ALL" || archived || promoter.availability === scope.availabilityFilter) && matchesQuery(scope.query, [promoter.name, promoter.specialties, promoter.phone, promoter.email]));
}

export function clientBulkRow(client: AdminClientRow): BulkTrashRow {
  return { id: client.id, name: clientPresentation(client).primary, archivedAt: client.archivedAt ?? null };
}
export function supplierBulkRow(supplier: AdminSupplierRow): BulkTrashRow {
  return { id: supplier.id, name: supplier.name, archivedAt: supplier.archivedAt ?? null };
}
export function promoterBulkRow(promoter: AdminPromoterRow): BulkTrashRow {
  return { id: promoter.id, name: promoter.name, archivedAt: promoter.archivedAt ?? null };
}
