import type { TrashEntityType } from "./trash-shared";

/** Contrato único del lote recuperable: nunca borrar definitivamente ni archivar por detrás. */
export type BulkTrashAction = "archive" | "trash";
export type BulkTrashRow = {
  id: string;
  name: string;
  archivedAt: string | null;
  /** Aviso orientativo; el servidor vuelve a validar estado y bloqueos bajo sus locks. */
  archiveBlockedReason?: string | null;
};
export type BulkTrashSelectionPage = {
  total: number;
  nextCursor: string | null;
  complete: boolean;
  /** Marca temporal del primer pedido, ligada al filtro/empresa/tipo en el cursor servidor. */
  snapshotAt: string;
};
export type BulkTrashOutcome = {
  row: BulkTrashRow;
  status: "success" | "blocked" | "failed" | "unknown";
  message: string;
};

/** Bloque CSV descargable del resultado del lote, compatible con el exportador común. */
export function bulkTrashReportBlock(report: BulkTrashOutcome[]) {
  const statusLabel: Record<BulkTrashOutcome["status"], string> = {
    success: "Confirmado",
    blocked: "Bloqueado",
    failed: "Fallido",
    unknown: "Por confirmar",
  };
  return {
    header: ["ID", "Registro", "Resultado", "Detalle"],
    rows: report.map((result) => [result.row.id, result.row.name, statusLabel[result.status], result.message]),
  };
}

export type BulkTrashOptions = {
  type: TrashEntityType;
  organizationId: string;
  /** Serialización estable del filtro + vista activo/archivado. No incluir orden/página. */
  scopeKey: string;
  enabled: boolean;
  /** Sólo esta página/vista; nunca fingir que equivale a todos los filtrados. */
  visibleRows: BulkTrashRow[];
  /** Materializa todas las páginas y aplica el MISMO predicado del listado; rechaza si no está completo. */
  loadAllRows: () => Promise<BulkTrashRow[]>;
  onChanged: () => void;
};

export function bulkTrashEligibility(row: BulkTrashRow, action: BulkTrashAction): string | null {
  if (action === "trash") return row.archivedAt ? null : "Archivalo primero: esta acción no archiva automáticamente.";
  if (row.archivedAt) return "Ya está archivado.";
  return row.archiveBlockedReason ?? null;
}
