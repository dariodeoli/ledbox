"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApiGet, adminApiUpload, clearAdminApiCache } from "@/lib/admin-api";
import { IMPORT_MODULES, type ImportModuleId } from "@/lib/import-modules";
import { CATALOG_LIMITS, DUDA_MOTIVO_LABEL } from "@/lib/import-catalog";
import type { CatalogImportMode } from "@/lib/import-catalog";
import { AdminButtonLink, AdminBadge, AdminButton, AdminDialog } from "./AdminUI";
import { FileField, SearchField, SegmentedField, SelectField, TextAreaField } from "./AdminFields";

/**
 * Diálogo «Importar» de un módulo. Una sola interfaz con tres caminos de
 * entrada (planilla, ChatGPT, IA de LedBox) que terminan en la MISMA vista
 * previa y en «Aplicar». El módulo (columnas, prompt, plantilla) sale del
 * registro `lib/import-modules.ts`; el servidor valida y aplica.
 */

type Tarjeta = { clave: string; etiqueta: string; valor: number };
type Problema = { nivel: "error" | "aviso"; tipo: string; codigo: string | null; mensaje: string; motivo?: string };
type Fila = { esCombo?: boolean; stockCountStatus?: "CONFIRMED" | "PENDING_COUNT"; countBefore?: number | null; countAfter?: number | null; codigo: string; nombre: string; accion: "crear" | "actualizar" | "omitir"; detalle: string };
type Preview = { importMode?: CatalogImportMode; catalogo: unknown; estados?: string | null; tarjetas: Tarjeta[]; problemas: Problema[]; filas: Fila[]; zip: boolean };
type Resultado = {
  lote: string;
  creados: Array<{ id: string; etiqueta: string }>;
  actualizados: number;
  juegos: number;
  fotos: number;
  omitidos: number;
  fallidos: Array<{ codigo: string; mensaje: string }>;
  /** Módulos con tarjetas propias (eventos): reemplazan a las del catálogo. */
  tarjetas?: Array<{ etiqueta: string; valor: number }>;
  avisos?: Array<{ codigo: string; mensaje: string }>;
};
type Camino = "planilla" | "chatgpt" | "ia";
type Progreso = { hecho: number; total: number; fase: string };

const MB = 1024 * 1024;
const ACCION_TONO = { crear: "ok", actualizar: "info", omitir: "danger" } as const;
const ACCION_TEXTO = { crear: "Crear", actualizar: "Actualizar", omitir: "Omitir" } as const;

export function AdminImportPanel({ moduloId, onClose, onApplied }: { moduloId: ImportModuleId; onClose: () => void; onApplied?: () => void }) {
  const modulo = IMPORT_MODULES[moduloId];
  const url = `/api/admin/import/${modulo.id}`;
  const [camino, setCamino] = useState<Camino>("planilla");
  const [importMode, setImportMode] = useState<CatalogImportMode>("CREATE_ONLY");
  const [planilla, setPlanilla] = useState<File | null>(null);
  const [json, setJson] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [texto, setTexto] = useState("");
  const [iaLista, setIaLista] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"vista" | "aplicar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [motivo, setMotivo] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  const lote = useMemo(() => crypto.randomUUID(), [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vivo = true;
    void adminApiGet<{ ia?: { disponible?: boolean } }>(url).then((respuesta) => {
      if (vivo) setIaLista(Boolean(respuesta.ok && respuesta.data?.ia?.disponible));
    });
    return () => {
      vivo = false;
    };
  }, [url]);

  const fuenteLista = camino === "planilla" ? Boolean(planilla) : camino === "chatgpt" ? Boolean(json) : texto.trim().length > 0 && iaLista === true;

  function formulario(accion: "preview" | "apply"): FormData {
    const form = new FormData();
    form.set("accion", accion);
    if (modulo.id === "productos") form.set("modo", importMode);
    if (accion === "apply") {
      form.set("catalogo", JSON.stringify(preview?.catalogo ?? {}));
      form.set("lote", lote);
    } else if (camino === "planilla" && planilla) {
      form.set("fuente", "planilla");
      form.set("planilla", planilla);
    } else if (camino === "chatgpt" && json) {
      form.set("fuente", "json");
      form.set("json", json);
    } else {
      form.set("fuente", "ia");
      form.set("texto", texto);
    }
    if (zip && modulo.photos) form.set("zip", zip);
    return form;
  }

  async function verVistaPrevia() {
    setBusy("vista");
    setError(null);
    const respuesta = await adminApiUpload<Preview>(url, formulario("preview"), { timeoutMs: 180_000, fallbackError: "No pudimos preparar la vista previa." });
    setBusy(null);
    if (!respuesta.ok) return setError(respuesta.error);
    setPreview(respuesta.data);
  }

  async function aplicar() {
    setBusy("aplicar");
    setError(null);
    setProgreso({ hecho: 0, total: 0, fase: "Subiendo archivos" });
    try {
      clearAdminApiCache();
      const response = await fetch(url, { method: "POST", body: formulario("apply") });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(response.status === 401 || response.status === 403 ? payload.error || "No tenés permiso para importar." : payload.error || "No pudimos aplicar la importación.");
        return;
      }
      // NDJSON: líneas de progreso y una final con el resultado (o el error).
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pendiente = "";
      let terminado = false;
      const procesar = (linea: string) => {
        if (!linea.trim()) return;
        const dato = JSON.parse(linea) as { progreso?: Progreso; resultado?: Resultado; error?: string };
        if (dato.progreso) setProgreso(dato.progreso);
        if (dato.resultado) {
          terminado = true;
          setResultado(dato.resultado);
          onApplied?.();
        }
        if (dato.error) {
          terminado = true;
          setError(dato.error);
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pendiente += decoder.decode(value, { stream: true });
        const lineas = pendiente.split("\n");
        pendiente = lineas.pop() ?? "";
        lineas.forEach(procesar);
      }
      procesar(pendiente);
      if (!terminado) setError("Se cortó la conexión antes de terminar. Revisá el inventario: reimportar no duplica.");
    } catch {
      setError("Se cortó la conexión antes de terminar. Revisá el inventario: reimportar no duplica.");
    } finally {
      clearAdminApiCache();
      setBusy(null);
      setProgreso(null);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(modulo.chatgptPrompt);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      setError("No pudimos copiar el texto: seleccionalo y copialo a mano.");
    }
  }

  async function leerTexto(file: File | null) {
    if (!file) return;
    setTexto((await file.text()).slice(0, 20_000));
  }

  const errores = preview?.problemas.filter((problema) => problema.nivel === "error") ?? [];
  const dudas = preview?.problemas.filter((problema) => problema.tipo === "duda") ?? [];
  const avisos = preview?.problemas.filter((problema) => problema.nivel === "aviso" && problema.tipo !== "duda") ?? [];
  const porMotivo = dudas.reduce<Record<string, number>>((acc, duda) => ({ ...acc, [duda.motivo ?? "otro"]: (acc[duda.motivo ?? "otro"] ?? 0) + 1 }), {});
  const dudasVisibles = dudas.filter((duda) => (motivo === "todas" || (duda.motivo ?? "otro") === motivo) && (!busqueda.trim() || `${duda.codigo} ${duda.mensaje}`.toLowerCase().includes(busqueda.trim().toLowerCase())));
  const aplicables = preview ? (preview.tarjetas.find((tarjeta) => tarjeta.clave === "crear")?.valor ?? 0) + (preview.tarjetas.find((tarjeta) => tarjeta.clave === "actualizar")?.valor ?? 0) : 0;

  const pie = resultado ? (
    <AdminButton type="button" variant="primary" onClick={onClose}>
      Cerrar
    </AdminButton>
  ) : preview ? (
    <>
      <AdminButton type="button" onClick={() => setPreview(null)} disabled={busy !== null}>
        Volver
      </AdminButton>
      <AdminButton type="button" variant="primary" icon="check" busy={busy === "aplicar"} busyLabel="Aplicando…" disabled={aplicables === 0} onClick={() => void aplicar()}>
        Aplicar ({aplicables})
      </AdminButton>
    </>
  ) : (
    <AdminButton type="button" variant="primary" busy={busy === "vista"} busyLabel="Analizando…" disabled={!fuenteLista} onClick={() => void verVistaPrevia()}>
      Ver vista previa
    </AdminButton>
  );

  return (
    <AdminDialog
      title={`Importar ${modulo.label.toLowerCase()}`}
      icon="upload"
      size="lg"
      onClose={onClose}
      dirty={Boolean(preview) && !resultado}
      description={resultado ? "Importación terminada." : preview ? "Revisá la vista previa. Todavía no se guardó nada." : "Elegí cómo cargar los datos. Antes de guardar vas a ver una vista previa."}
      error={error}
      warning={busy === "aplicar" && progreso ? `${progreso.fase}${progreso.total ? `: ${progreso.hecho} de ${progreso.total}` : "…"}` : null}
      footer={pie}
    >
      {resultado ? (
        <div className="admin-import">
          <div className="admin-import-cards" role="list">
            {(resultado.tarjetas
              ? resultado.tarjetas.map((tarjeta): [string, number] => [tarjeta.etiqueta, tarjeta.valor])
              : [
                  ["Creados", resultado.creados.length],
                  ["Actualizados", resultado.actualizados],
                  ["Juegos", resultado.juegos],
                  ["Fotos", resultado.fotos],
                  ["Omitidos", resultado.omitidos],
                ]
            ).map(([etiqueta, valor]) => (
              <div key={etiqueta} className="admin-import-card" role="listitem">
                <strong>{valor}</strong>
                <span>{etiqueta}</span>
              </div>
            ))}
          </div>
          {resultado.fallidos.length > 0 ? (
            <ul className="admin-import-problems" aria-label="Lo que no se pudo importar">
              {resultado.fallidos.map((fallo, index) => (
                <li key={`${fallo.codigo}-${index}`}>
                  <AdminBadge tone="danger">{fallo.codigo}</AdminBadge> {fallo.mensaje}
                </li>
              ))}
            </ul>
          ) : null}
          {resultado.avisos && resultado.avisos.length > 0 ? (
            <ul className="admin-import-problems" aria-label="Avisos de la importación">
              {resultado.avisos.map((aviso, index) => (
                <li key={`${aviso.codigo}-${index}`}>
                  <AdminBadge tone="warn">{aviso.codigo}</AdminBadge> {aviso.mensaje}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="admin-field-hint">Lote {resultado.lote.slice(0, 8)} auditado. Reimportar el mismo archivo actualiza, no duplica.</p>
        </div>
      ) : preview ? (
        <div className="admin-import">
          <div className="admin-import-cards" role="list">
            {preview.tarjetas.map((tarjeta) => (
              <div key={tarjeta.clave} className="admin-import-card" role="listitem">
                <strong>{tarjeta.valor}</strong>
                <span>{tarjeta.etiqueta}</span>
              </div>
            ))}
          </div>
          {preview.importMode ? <p className="admin-field-hint">{preview.importMode === "CREATE_ONLY" ? "Sólo nuevos: los códigos existentes y sus datos se conservan." : "Crear nuevos y actualizar existentes."}</p> : null}
          {preview.estados ? <p className="admin-field-hint">{preview.estados}</p> : null}
          {errores.length > 0 ? (
            <section aria-label="Errores">
              <h3 className="admin-import-h">Errores ({errores.length}): {modulo.errorNote ?? "esos productos no se importan"}</h3>
              <ul className="admin-import-problems">
                {errores.map((problema, index) => (
                  <li key={`e${index}`}>
                    <AdminBadge tone="danger">{problema.codigo ?? "Archivo"}</AdminBadge> {problema.mensaje}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {avisos.length > 0 ? (
            <section aria-label="Avisos">
              <h3 className="admin-import-h">Avisos ({avisos.length}): se importan igual</h3>
              <ul className="admin-import-problems">
                {avisos.map((problema, index) => (
                  <li key={`a${index}`}>
                    <AdminBadge tone="warn">{problema.codigo ?? "General"}</AdminBadge> {problema.mensaje}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {dudas.length > 0 ? (
            <section aria-label="Dudas">
              <h3 className="admin-import-h">Dudas de la IA ({dudas.length}): revisalas antes de aplicar; no son obligatorias</h3>
              <div className="admin-import-filters">
                <SelectField
                  label="Motivo"
                  value={motivo}
                  onChange={setMotivo}
                  options={[{ value: "todas", label: `Todas (${dudas.length})` }, ...Object.entries(porMotivo).map(([clave, cantidad]) => ({ value: clave, label: `${DUDA_MOTIVO_LABEL[clave as keyof typeof DUDA_MOTIVO_LABEL] ?? clave} (${cantidad})` }))]}
                />
                <SearchField label="Buscar en las dudas" value={busqueda} onChange={setBusqueda} placeholder="Código o texto" />
              </div>
              <p className="admin-field-hint" aria-live="polite">Mostrando {dudasVisibles.length} de {dudas.length}</p>
              <ul className="admin-import-problems admin-import-dudas">
                {dudasVisibles.map((problema, index) => (
                  <li key={`d${index}`}>
                    <AdminBadge tone="warn">{problema.codigo ?? "General"}</AdminBadge> <AdminBadge tone="neutral">{DUDA_MOTIVO_LABEL[(problema.motivo ?? "otro") as keyof typeof DUDA_MOTIVO_LABEL] ?? "Otras"}</AdminBadge> {problema.mensaje}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {errores.length === 0 && avisos.length === 0 && dudas.length === 0 ? <p className="admin-field-hint">Sin problemas detectados.</p> : null}
          <section aria-label="Filas">
            <h3 className="admin-import-h">Filas ({preview.filas.length})</h3>
            <ul className="admin-import-rows">
              {preview.filas.map((fila) => (
                <li key={fila.codigo}>
                  <AdminBadge tone={ACCION_TONO[fila.accion]}>{ACCION_TEXTO[fila.accion]}</AdminBadge>
                  <span className="admin-import-row-main">
                    <strong>{fila.codigo}</strong> {fila.nombre}
                  </span>
                  <span className="admin-field-hint">{fila.detalle}{modulo.id === "productos" && !fila.esCombo && fila.stockCountStatus ? ` · Stock: ${fila.countBefore === null ? "desconocido" : fila.countBefore ?? "—"} → ${fila.stockCountStatus === "PENDING_COUNT" ? "pendiente de conteo" : fila.countAfter ?? "—"}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <div className="admin-import">
          <SegmentedField
            ariaLabel="Cómo importar"
            value={camino}
            onChange={(valor) => {
              setCamino(valor as Camino);
              setError(null);
            }}
            options={[
              { value: "planilla", label: "Planilla" },
              { value: "chatgpt", label: "Con ChatGPT" },
              { value: "ia", label: "IA de LedBox" },
            ]}
          />
          {modulo.id === "productos" ? <SelectField label="Productos existentes" size="full" value={importMode} onChange={(value) => setImportMode(value as CatalogImportMode)} options={[{ value: "CREATE_ONLY", label: "Crear sólo productos nuevos" }, { value: "UPSERT", label: "Crear nuevos y actualizar existentes" }]} hint="Crear sólo nuevos conserva íntegros los códigos existentes, su stock, tarifas y fotos." /> : null}
          {camino === "planilla" ? (
            <>
              <p className="admin-field-hint">Descargá la plantilla con las columnas exactas, completala y subila en .xlsx o .csv.</p>
              <div className="admin-inv-actions">
                <AdminButtonLink href={`${url}?formato=xlsx`} download>
                  Descargar plantilla (.xlsx)
                </AdminButtonLink>
                <AdminButtonLink href={`${url}?formato=csv`} download>
                  Descargar plantilla (.csv)
                </AdminButtonLink>
              </div>
              <FileField label="Planilla completa" accept=".xlsx,.csv,text/csv" maxBytes={CATALOG_LIMITS.sheetBytes} file={planilla} onSelect={setPlanilla} hint=".xlsx o .csv, hasta 5 MB" />
            </>
          ) : null}
          {camino === "chatgpt" ? (
            <>
              <p className="admin-field-hint">{modulo.chatgptHint ?? "Copiá este texto, pegalo en ChatGPT junto con tu catálogo y subí acá el catalogo.json (y el fotos.zip) que te devuelva."}</p>
              <TextAreaField ariaLabel="Texto para ChatGPT" value={modulo.chatgptPrompt} onChange={() => {}} rows={8} autoGrow={false} wide />
              <div className="admin-inv-actions">
                <AdminButton type="button" icon="copy" onClick={() => void copiar()}>
                  {copiado ? "Copiado" : "Copiar"}
                </AdminButton>
              </div>
              <FileField label={modulo.jsonName ?? "catalogo.json"} accept=".json,application/json" maxBytes={CATALOG_LIMITS.jsonBytes} file={json} onSelect={setJson} hint="Hasta 2 MB" />
            </>
          ) : null}
          {camino === "ia" ? (
            <>
              {iaLista === false ? (
                <p className="admin-field-error" role="alert">
                  La IA de LedBox no está disponible en esta empresa (sin configurar o modo demo). Usá la planilla o ChatGPT.
                </p>
              ) : null}
              <p className="admin-field-hint">{modulo.iaHint ?? "Pegá el texto del catálogo, factura o lista (hasta 25 productos por vez). La IA lee texto: de un PDF o una foto, copiá el texto antes de pegarlo."}</p>
              <TextAreaField label="Texto" value={texto} onChange={setTexto} rows={8} maxLength={20_000} counter wide disabled={iaLista !== true} />
              <FileField label="O un archivo de texto" accept=".txt,.csv,.md,.json,text/plain" maxBytes={200 * 1024} file={null} onSelect={(file) => void leerTexto(file)} disabled={iaLista !== true} hint=".txt, .csv, .md o .json, hasta 200 KB" />
            </>
          ) : null}
          {modulo.photos ? (
            <FileField label="fotos.zip (opcional)" accept=".zip,application/zip" maxBytes={CATALOG_LIMITS.zipBytes} file={zip} onSelect={setZip} hint="Un archivo por producto: <codigo>.jpg, .png o .webp. Hasta 60 MB y 400 fotos." />
          ) : null}
        </div>
      )}
    </AdminDialog>
  );
}
