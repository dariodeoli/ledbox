"use client";
import { useEffect, useRef, useState } from "react";
import { AdminButton, AdminDialog } from "./AdminUI";
import { FileField, TextField } from "./AdminFields";
import { adminApiGet, adminApiUpload, clearAdminApiCache } from "@/lib/admin-api";
import { downloadCsv, csvFilename } from "@/lib/admin-export";
import { formatMoney } from "@/lib/admin-format";
import type { SelectedPriceResult } from "@/lib/import-selected-prices";
type Change = {
    campo: string;
    antes: unknown;
    despues: unknown;
};
type Preview = {
    catalogo: unknown;
    confirmationToken: string;
    filas: Array<{
        fila: number;
        codigo: string;
        nombre: string;
        detalle: string;
        cambios: Change[];
        errores: string[];
    }>;
};
type Report = {
    lote: string;
    filasPrecio: SelectedPriceResult[];
    reintento: {
        productos: unknown[];
    };
};
const URL = "/api/admin/import/productos";
const example = { productos: [{ codigo: "CODIGO-EXISTENTE", cambios: { listPrice: { op: "REPLACE", value: 25000 }, wholesalePrice: { op: "KEEP" }, minimumPrice: { op: "CLEAR" }, tarifasFinal: { op: "REPLACE", value: [{ fromDays: 3, mode: "TOTAL", price: 60000 }] } } }] };
function valueText(value: unknown) {
    if (typeof value === "boolean")
        return value ? "Precio propio" : "Precio heredado";
    if (typeof value === "number")
        return value === 0 ? "Sin importe cargado (0)" : formatMoney(value);
    if (Array.isArray(value))
        return value.length ? value.map(t => `${t.fromDays} días: ${formatMoney(t.price)} ${t.mode === "TOTAL" ? "total" : "por día"}`).join("; ") : "Sin escalones";
    return "—";
}
export function SelectedPriceImport({ onClose, onBack, onApplied }: {
    onClose: () => void;
    onBack: () => void;
    onApplied?: () => void;
}) {
    const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<Preview | null>(null);
    const [lote, setLote] = useState(""), [recover, setRecover] = useState("");
    const [reports, setReports] = useState<Report[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    const alive = useRef(true);
    const sources = useRef(new Map<string, File>());
    useEffect(() => { alive.current = true; try {
        setRecover(sessionStorage.getItem("ledbox:import-precios:ultimo-lote") ?? "");
    }
    catch { } return () => { alive.current = false; }; }, []);
    const remember = (report: Report) => setReports(rows => [report, ...rows.filter(r => r.lote !== report.lote)]);
    async function inspect() {
        if (!file || busy)
            return;
        setBusy(true);
        setError(null);
        const form = new FormData();
        form.set("modo", "UPDATE_SELECTED");
        form.set("accion", "preview");
        form.set("fuente", "json");
        form.set("json", file);
        const response = await adminApiUpload<Preview>(URL, form);
        if (!alive.current)
            return;
        setBusy(false);
        if (!response.ok)
            return setError(response.error);
        setPreview(response.data);
        setLote(crypto.randomUUID());
    }
    async function apply() {
        if (!preview || busy)
            return;
        setBusy(true);
        setError(null);
        const form = new FormData();
        form.set("modo", "UPDATE_SELECTED");
        form.set("accion", "apply");
        form.set("catalogo", JSON.stringify(preview.catalogo));
        form.set("confirmationToken", preview.confirmationToken);
        form.set("lote", lote);
        try {
            sessionStorage.setItem("ledbox:import-precios:ultimo-lote", lote);
        }
        catch { }
        setRecover(lote);
        if (file)
            sources.current.set(lote, file);
        const response = await adminApiUpload<Report>(URL, form, { timeoutMs: 180000, fallbackError: "No se recibió el final. Recuperá el reporte o reintentá este mismo lote; los éxitos no se repiten." });
        clearAdminApiCache();
        if (!alive.current)
            return;
        setBusy(false);
        if (!response.ok)
            return setError(response.error);
        remember(response.data);
        setPreview(null);
        onApplied?.();
    }
    async function loadReport() {
        if (busy)
            return;
        setBusy(true);
        setError(null);
        const response = await adminApiGet<Report>(`${URL}?formato=reporte-precios&lote=${encodeURIComponent(recover.trim())}`, { fresh: true });
        if (!alive.current)
            return;
        setBusy(false);
        if (!response.ok)
            return setError(response.error);
        remember(response.data);
    }
    function csv(report: Report) {
        downloadCsv(csvFilename(`importacion-precios-${report.lote.slice(0, 8)}`), [{ header: ["Lote", "Fila", "Código", "Estado", "Campo", "Antes", "Después", "Mensaje"], rows: report.filasPrecio.flatMap(row => (row.cambios?.length ? row.cambios : [{ campo: "", antes: null, despues: null }]).map(change => [report.lote, row.fila, row.codigo, row.estado, change.campo, valueText(change.antes), valueText(change.despues), row.mensaje])) }]);
    }
    function next() { setFile(null); setPreview(null); setLote(""); setError(null); }
    function retry(report: Report) { setFile(new File([JSON.stringify(report.reintento)], "precios-pendientes.json", { type: "application/json" })); setPreview(null); setLote(""); setError(null); }
    return <AdminDialog title="Actualizar sólo precios" description="Sólo códigos existentes. Conserva fotos, stock, estados, identidad y los campos no elegidos." onClose={onClose} size="lg" error={error} dirty={Boolean(preview)} footer={<><AdminButton disabled={busy} onClick={onBack}>Volver a importar catálogo</AdminButton>{preview ? <AdminButton variant="primary" busy={busy} disabled={busy || !preview.filas.some(row => !row.errores.length)} onClick={() => void apply()}>Aplicar precios revisados</AdminButton> : <AdminButton variant="primary" busy={busy} disabled={!file || busy} onClick={() => void inspect()}>Ver antes y después</AdminButton>}</>}>
    <p>JSON de instrucciones: campo ausente o KEEP conserva; CLEAR deja el importe en cero o vacía los escalones; REPLACE reemplaza por value. Separa tarifasFinal de tarifasMayorista. No admite fotos ni cambios de estados en esta entrega.</p>
    <details><summary>Formato y campos admitidos</summary><p>listPrice (final), wholesalePrice (mayorista), minimumPrice (mínimo), tarifasFinal y tarifasMayorista. Escalones: fromDays, mode PER_DAY o TOTAL y price. Null o vacío no borran datos.</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(example, null, 2)}</pre></details>
    <FileField label="JSON selectivo de precios" accept=".json,application/json" maxBytes={2 * 1024 * 1024} file={file} onSelect={f => { setFile(f); setPreview(null); setLote(""); }} disabled={busy}/>
    {preview ? <><AdminButton onClick={() => downloadCsv(csvFilename("revision-precios"), [{ header: ["Fila", "Código", "Campo", "Antes", "Después", "Errores"], rows: preview.filas.flatMap(row => (row.cambios.length ? row.cambios : [{ campo: "", antes: null, despues: null }]).map(c => [row.fila, row.codigo, c.campo, valueText(c.antes), valueText(c.despues), row.errores.join(" ")])) }])}>Descargar revisión CSV</AdminButton><p>Confirmación válida por 15 minutos. Si cambia un precio elegido, se bloquea su fila; cambios en otros campos se conservan.</p><ul className="admin-import-problems">{preview.filas.map(row => <li key={row.fila}><strong>{row.fila} · {row.codigo} · {row.nombre}</strong><p>{row.detalle}</p>{row.cambios.map(change => <p key={change.campo}>{change.campo}: {valueText(change.antes)} → {valueText(change.despues)}</p>)}</li>)}</ul></> : null}
    <TextField label="Recuperar reporte por identificador de lote" value={recover} onChange={setRecover} maxLength={36} disabled={busy}/>
    <AdminButton disabled={busy || !/^[0-9a-f-]{36}$/i.test(recover.trim())} onClick={() => void loadReport()}>Recuperar reporte (7 días)</AdminButton>
    {reports.map(report => <section key={report.lote}><h3>Lote {report.lote.slice(0, 8)}</h3><p>Reporte recuperable por 7 días. Los archivos locales no se guardan al cerrar; conservá el JSON original y el identificador {report.lote}.</p><ul className="admin-import-problems">{report.filasPrecio.map(row => <li key={row.fila}><strong>{row.fila} · {row.codigo} · {row.estado}</strong>: {row.mensaje}</li>)}</ul><AdminButton onClick={() => csv(report)}>Descargar reporte CSV</AdminButton>{sources.current.has(report.lote) ? <><p>Original retenido en esta sesión: {sources.current.get(report.lote)!.name}.</p><AdminButton disabled={busy} onClick={() => { setFile(sources.current.get(report.lote)!); setPreview(null); setLote(""); setError(null); }}>Revisar archivo original completo</AdminButton></> : null}<AdminButton disabled={busy} onClick={next}>Cargar otro lote (conservar reportes)</AdminButton>{report.reintento.productos.length ? <AdminButton disabled={busy} onClick={() => retry(report)}>Preparar sólo pendientes para nueva revisión</AdminButton> : null}</section>)}
  </AdminDialog>;
}
