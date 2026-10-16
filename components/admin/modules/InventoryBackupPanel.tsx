"use client";
import { useState } from "react";
import { publicConfig } from "@/lib/public-config";
import { formatBytes, formatNumber } from "@/lib/admin-format";
import { useAdminSession } from "../AdminShell";
import { FileField } from "../AdminFields";
import { AdminButton, AdminButtonLink, AdminNote, AdminPanel } from "../AdminUI";
const entityLabels: Record<string, string> = { Supplier: "Proveedores y dueños", Warehouse: "Depósitos", InventoryCategory: "Categorías", InventoryFamily: "Familias", InventoryItem: "Productos", InventoryUnit: "Unidades", InventoryPriceTier: "Precios por duración", InventoryComponent: "Componentes", InventoryImage: "Fotos adicionales", Collection: "Colecciones", CollectionItem: "Productos en colecciones" };
type Preview = { token: string; summary: Record<string, number>; assetBytes: number; externalReferences: number; exclusions: string[] };
export function InventoryBackupPanel() {
  const { sandbox } = useAdminSession();
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run(restore: boolean) {
    if (!file || busy) return; setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("backup", file); form.set("action", restore ? "restore" : "preview");
      if (preview) form.set("token", preview.token);
      const response = await fetch("/api/admin/inventory/backup", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo procesar el respaldo.");
      if (restore) window.location.assign("/inventario"); else setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo procesar el respaldo."); }
    finally { setBusy(false); }
  }
  return <AdminPanel title="Respaldo de catálogo e inventario" icon="database" meta="ZIP portable v1 · ensayo en una demo nueva">
    <p>Incluye productos, unidades, propietarios, depósitos, variantes, precios por segmento y fotos almacenadas. No es un respaldo completo de la empresa: excluye historial operativo, reservas, caja, firmas, usuarios y secretos. Las imágenes externas conservan sólo su referencia.</p>
    <p>Máximo 20 MiB de ZIP y contenido total, 15 MiB de imágenes y 10.000 registros. Se rechaza un respaldo que exceda el límite; no se descarga una copia truncada.</p>
    <AdminButtonLink href="/api/admin/inventory/backup" download icon="download">Descargar respaldo</AdminButtonLink>
    {!sandbox ? <><p>Para ensayar una restauración, entrá a la demo y subí allí el ZIP. El ensayo crea otra demo vacía y no modifica la empresa original. La demo vence como siempre.</p><AdminButtonLink href={publicConfig.demoUrl} target="_blank">Abrir demo</AdminButtonLink></> : <>
      <FileField label="Respaldo para ensayar" file={file} maxBytes={20 * 1024 * 1024} accept=".zip,application/zip" disabled={busy} onSelect={next => { setFile(next); setPreview(null); setError(""); }} />
      <AdminButton disabled={!file || busy} busy={busy} onClick={() => void run(false)}>Revisar respaldo</AdminButton>
      {preview ? <>
        <p>Se restaurará en una demo nueva y vacía. Cancelar no cambia ningún dato. La demo actual y la empresa original quedan intactas.</p>
        <dl>{Object.entries(preview.summary).map(([name, count]) => <div key={name}><dt>{entityLabels[name] ?? name}</dt><dd>{formatNumber(count)}</dd></div>)}</dl>
        <p>Imágenes: {formatBytes(preview.assetBytes)}. Referencias externas sin archivar: {formatNumber(preview.externalReferences)}.</p>
        <AdminNote>{preview.exclusions.join(" · ")}</AdminNote>
        <AdminButton variant="primary" disabled={busy} busy={busy} onClick={() => void run(true)}>Confirmar restauración en demo nueva</AdminButton>
        <AdminButton disabled={busy} onClick={() => { setPreview(null); setFile(null); }}>Cancelar</AdminButton>
      </> : null}
    </>}
    {error ? <AdminNote tone="error">{error}</AdminNote> : null}
  </AdminPanel>;
}
