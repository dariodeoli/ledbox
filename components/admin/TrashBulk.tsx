"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { bulkTrashReportBlock, type BulkTrashAction, type BulkTrashOptions, type BulkTrashOutcome, type BulkTrashRow } from "@/lib/bulk-trash";
import { performBulkTrash } from "@/lib/admin-bulk-trash";
import { formatNumber } from "@/lib/admin-format";
import { csvFilename, downloadCsv } from "@/lib/admin-export";
import { TRASH_ENTITIES } from "@/lib/trash-shared";
import { TextAreaField } from "./AdminFields";
import { AdminButton, AdminDialog, AdminNote } from "./AdminUI";
import { RowCheck } from "./modules/InventoryParts";

export function useBulkTrash(options: BulkTrashOptions) {
  const [items, setItems] = useState<Map<string, BulkTrashRow>>(new Map());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [pinnedScope, setPinnedScope] = useState(options.scopeKey);
  const [loadingAll, setLoadingAll] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [action, setAction] = useState<BulkTrashAction | null>(null), [reason, setReason] = useState("");
  const [report, setReport] = useState<BulkTrashOutcome[]>([]);
  const [uncertainIds, setUncertainIds] = useState<Set<string>>(new Set());
  const reportKey = `ledbox:bulk-trash:${options.organizationId}:${options.type}`;
  function persistReport(rows: BulkTrashOutcome[]) {
    try { window.sessionStorage.setItem(reportKey, JSON.stringify(rows)); } catch { /* El informe en pantalla permanece disponible. */ }
  }
  const current = useRef(options); current.current = options;
  const generation = useRef(0), mounted = useRef(true), running = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setItems(new Map()); setExcluded(new Set()); setPinnedScope(options.scopeKey); setReport([]); setAction(null); setError(""); setLoadingAll(false); setBusy(false); setUncertainIds(new Set());
    try { const saved = JSON.parse(window.sessionStorage.getItem(reportKey) ?? "[]") as BulkTrashOutcome[]; if (Array.isArray(saved)) { const valid = saved.filter(row => row?.row?.id && ["success", "blocked", "failed", "unknown"].includes(row.status)); setReport(valid); setUncertainIds(new Set(valid.filter(row => row.status === "unknown").map(row => row.row.id))); } } catch { /* Un informe ilegible no ejecuta acciones. */ }
  }, [options.organizationId]);
  const selectionScopeChanged = items.size > 0 && pinnedScope !== options.scopeKey;
  const selected = [...items.values()].filter(row => !excluded.has(row.id));
  const count = selected.length;
  function clear() { if (running.current) return; generation.current++; setItems(new Map()); setExcluded(new Set()); setLoadingAll(false); setError(""); }
  function toggle(row: BulkTrashRow) {
    if (!options.enabled || busy || loadingAll) return;
    if (items.has(row.id)) setExcluded(previous => { const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
    else if (!selectionScopeChanged) { setPinnedScope(options.scopeKey); setItems(previous => new Map(previous).set(row.id, row)); }
  }
  function selectVisible() { if (!options.enabled || busy) return; generation.current++; setLoadingAll(false); setPinnedScope(options.scopeKey); setItems(new Map(options.visibleRows.map(row => [row.id, row]))); setExcluded(new Set()); setError(""); }
  async function selectAll() {
    if (!options.enabled || busy || loadingAll) return;
    const captured = options, run = ++generation.current; setLoadingAll(true); setError("");
    try {
      const rows = await captured.loadAllRows();
      if (!mounted.current || run !== generation.current || captured.organizationId !== current.current.organizationId || captured.scopeKey !== current.current.scopeKey) return;
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Hay filas repetidas en la selección.");
      setPinnedScope(captured.scopeKey); setItems(new Map(rows.map(row => [row.id, row]))); setExcluded(new Set()); setUncertainIds(new Set());
    } catch (failure) { if (mounted.current && run === generation.current) setError(failure instanceof Error ? failure.message : "No pudimos completar la selección."); }
    finally { if (mounted.current && run === generation.current) setLoadingAll(false); }
  }
  async function apply() {
    if (!options.enabled || running.current || !action || !count || selected.some(row => uncertainIds.has(row.id)) || reason.length > 200) return;
    const captured = options, capturedAction = action, rows = [...selected], run = ++generation.current;
    running.current = true; setBusy(true); setReport([]); setError("");
    const results: BulkTrashOutcome[] = [];
    try {
      for (const row of rows) {
        if (!mounted.current || run !== generation.current || captured.organizationId !== current.current.organizationId || !current.current.enabled) break;
        persistReport([...results, { row, status: "unknown", message: "Intento iniciado; consultar estado si se perdió la respuesta. No se reanudará automáticamente." }]);
        const result = await performBulkTrash(captured.type, row, capturedAction, reason);
        results.push(result); persistReport(results); if (result.status === "unknown" && mounted.current && captured.organizationId === current.current.organizationId) setUncertainIds(previous => new Set(previous).add(row.id)); if (mounted.current && captured.organizationId === current.current.organizationId) setReport([...results]);
        if (result.status === "success" && mounted.current && captured.organizationId === current.current.organizationId) setItems(previous => { const next = new Map(previous); next.delete(row.id); return next; });
        if (result.status === "unknown") break;
      }
    } finally {
      running.current = false;
      if (mounted.current && captured.organizationId === current.current.organizationId) { setBusy(false); setAction(null); captured.onChanged(); }
    }
  }
  return { options, count, selected, excludedCount: excluded.size, selectionScopeChanged, loadingAll, busy, error, action, reason, report,
    isKnown: (id: string) => items.has(id), hasUncertainSelection: selected.some(row => uncertainIds.has(row.id)), isSelected: (id: string) => items.has(id) && !excluded.has(id), toggle, clear, selectVisible, selectAll, apply, replaceSelection: (rows: BulkTrashRow[]) => { if (!running.current) { setItems(new Map(rows.map(row => [row.id, row]))); setExcluded(new Set()); setPinnedScope(options.scopeKey); } }, setAction, setReason };
}
export type BulkTrashController = ReturnType<typeof useBulkTrash>;
export function BulkRowCheck({ bulk, row }: { bulk: BulkTrashController; row: BulkTrashRow }) {
  if (!bulk.options.enabled) return null;
  return <span onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onDragStart={event => event.preventDefault()}><RowCheck checked={bulk.isSelected(row.id)} disabled={bulk.busy || bulk.loadingAll || (bulk.selectionScopeChanged && !bulk.isKnown(row.id))} label={`Seleccionar ${row.name}`} onToggle={() => bulk.toggle(row)} /></span>;
}
export function BulkTrashControls({ bulk, children }: { bulk: BulkTrashController; children?: ReactNode }) {
  if (!bulk.options.enabled) return null;
  return <>
    <div className="admin-bulkbar" role="region" aria-label="Selección y acciones en lote">
      <strong>{formatNumber(bulk.count)} seleccionados · {formatNumber(bulk.options.visibleRows.length)} visibles</strong>
      <span className="admin-bulkbar-actions">
        {children}
        <AdminButton disabled={bulk.busy || bulk.loadingAll} onClick={bulk.selectVisible}>{bulk.selectionScopeChanged ? "Reemplazar por esta página" : "Seleccionar esta página"}</AdminButton>
        <AdminButton busy={bulk.loadingAll} disabled={bulk.busy} onClick={() => void bulk.selectAll()}>{bulk.selectionScopeChanged ? "Reemplazar por todos los filtrados" : "Seleccionar todos los filtrados"}</AdminButton>
        <AdminButton disabled={!bulk.count || bulk.busy || bulk.loadingAll || bulk.hasUncertainSelection} onClick={() => bulk.setAction("archive")}>Archivar seleccionados</AdminButton>
        <AdminButton icon="trash" disabled={!bulk.count || bulk.busy || bulk.loadingAll || bulk.hasUncertainSelection} onClick={() => bulk.setAction("trash")}>Enviar a papelera</AdminButton>
        <AdminButton icon="close" disabled={bulk.busy} onClick={bulk.clear}>Quitar selección</AdminButton>
      </span>
    </div>
    {bulk.selectionScopeChanged ? <AdminNote>Se conserva la selección del filtro anterior. No se agregaron los resultados del filtro nuevo; reemplazá la selección explícitamente si querés cambiarlos.</AdminNote> : null}
    {bulk.hasUncertainSelection ? <AdminNote tone="warn">Hay un intento por confirmar. Consultá su estado y recargá todos los filtrados antes de preparar otra acción; no se reintenta automáticamente.</AdminNote> : null}
    {bulk.error ? <AdminNote tone="error">{bulk.error}</AdminNote> : null}
    {bulk.report.length ? <BulkTrashReport report={bulk.report} /> : null}
    {bulk.action ? <AdminDialog title={bulk.action === "archive" ? "Archivar selección" : "Enviar selección a papelera"} description={`${formatNumber(bulk.count)} registros de tipo ${TRASH_ENTITIES[bulk.options.type].typeLabel}. ${bulk.excludedCount} excepciones no se tocarán.`} onClose={() => { if (!bulk.busy) bulk.setAction(null); }}
      footer={<><AdminButton disabled={bulk.busy} onClick={() => bulk.setAction(null)}>Cancelar</AdminButton><AdminButton variant="primary" busy={bulk.busy} disabled={bulk.reason.length > 200} onClick={() => void bulk.apply()}>Confirmar {bulk.action === "archive" ? "archivado" : "envío a papelera"}</AdminButton></>}>
      <AdminNote>{bulk.action === "archive" ? "Se conservan datos e historial. Cada registro se valida y los bloqueados permanecen sin cambios." : "Sólo se eliminarán registros ya archivados y sin bloqueos. No se archiva por detrás. OWNER y ADMIN pueden recuperar desde Ajustes → Eliminados hasta la purga definitiva configurada."}</AdminNote>
      <TextAreaField label="Motivo (opcional)" value={bulk.reason} onChange={bulk.setReason} maxLength={200} rows={2} />
      <AdminNote>El lote se procesa registro por registro. Un resultado incierto detiene el resto; no se reintenta automáticamente ni se revierte lo ya confirmado.</AdminNote>
    </AdminDialog> : null}
  </>;
}
function BulkTrashReport({ report }: { report: BulkTrashOutcome[] }) {
  return <div role="region" aria-label="Resultado del lote"><AdminNote>{report.filter(row => row.status === "success").length} confirmados · {report.filter(row => row.status === "blocked").length} bloqueados · {report.filter(row => row.status === "failed").length} fallidos · {report.filter(row => row.status === "unknown").length} por confirmar</AdminNote><AdminButton onClick={() => downloadCsv(csvFilename("resultado-lote"), [bulkTrashReportBlock(report)])}>Descargar informe CSV</AdminButton><ul className="admin-overdue-list">{report.map(result => <li key={result.row.id}><strong>{result.row.name}:</strong> {result.message}</li>)}</ul></div>;
}
