"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime, formatNumber, messageTemplateCategoryLabel } from "@/lib/admin-format";
import { canWriteTemplateCategory, matchesQuery } from "@/lib/admin-policy";
import { MESSAGE_TEMPLATE_CATEGORIES, type AdminMessageTemplateRow, type MessageTemplateCategoryValue } from "@/lib/admin-types";
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_TEMPLATE_BODY_MAX, MESSAGE_TEMPLATE_TITLE_MAX, messageTemplateVariablesOf, previewMessageTemplate, validateMessageTemplate } from "@/lib/server/message-templates";
import { useAdminSession } from "../AdminShell";
import { AdminBadge, AdminButton, AdminConfirmDialog, AdminDataState, AdminEmpty, AdminModuleContext, AdminNote, AdminPanel } from "../AdminUI";
import { SearchField, SelectField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { ClientesTabs } from "./ClientesTabs";

type TemplateForm = { id: string; category: MessageTemplateCategoryValue; title: string; body: string; active: boolean };
const EMPTY_FORM: TemplateForm = { id: "", category: "budget", title: "", body: "", active: true };
const formOf = (row: AdminMessageTemplateRow): TemplateForm => ({ id: row.id, category: row.category, title: row.title, body: row.body, active: row.active });

/** Misma biblioteca y API que el compositor; personalizar acá nunca envía un mensaje. */
export function PlantillasModule() {
  const { role } = useAdminSession();
  const resource = useAdminResource("/api/admin/message-templates", (payload) => payload.templates ?? []);
  const [category, setCategory] = useState<MessageTemplateCategoryValue>("budget");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [modelKey, setModelKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AdminMessageTemplateRow | null>(null);
  const [pendingChange, setPendingChange] = useState<(() => void) | null>(null);
  const baseRef = useRef("");
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const formId = useId();
  const templates = useMemo(() => resource.data ?? [], [resource.data]);
  const rows = useMemo(() => templates.filter((row) => row.category === category && matchesQuery(query, [row.title, row.body])).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "es")), [templates, category, query]);
  const models = DEFAULT_MESSAGE_TEMPLATES.filter((row) => row.category === category);
  const model = models.find((row) => row.key === modelKey);
  const writable = canWriteTemplateCategory(role, category);
  const dirty = form !== null && JSON.stringify(form) !== baseRef.current;
  const preview = useMemo(() => form ? previewMessageTemplate(form.body, form.category) : null, [form]);

  function selectTemplate(row: AdminMessageTemplateRow) {
    const next = formOf(row);
    baseRef.current = JSON.stringify(next);
    setForm(next);
    setModelKey(DEFAULT_MESSAGE_TEMPLATES.find((model) => model.category === row.category && (row.id.endsWith(`_tpl_${model.key}`) || row.title === model.title))?.key ?? "");
    setError("");
  }
  // La selección inicial se limita a la categoría visible; no cambia una edición en curso.
  useEffect(() => { if (!resource.loading && !form && rows.length) selectTemplate(rows[0]); }, [rows, form, resource.loading]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  function requestChange(action: () => void) { if (busy) return; if (dirty) setPendingChange(() => action); else action(); }
  function createTemplate() {
    const next = { ...EMPTY_FORM, category };
    baseRef.current = JSON.stringify(next); setForm(next); setModelKey(""); setError(""); setNotice("");
  }
  function applyModel(key: string) {
    const selected = models.find((row) => row.key === key);
    if (!selected || !writable || !form) return;
    setModelKey(key);
    setForm({ ...form, title: form.title || selected.title, body: selected.body });
    setError("");
  }
  function insertVariable(key: string) {
    if (!form || !writable || busy) return;
    const token = `{{${key}}}`, node = messageRef.current;
    const start = node?.selectionStart ?? form.body.length, end = node?.selectionEnd ?? start;
    const body = `${form.body.slice(0, start)}${token}${form.body.slice(end)}`;
    if (body.length > MESSAGE_TEMPLATE_BODY_MAX) { setError("No hay espacio para esa variable. Acortá el mensaje antes de insertarla."); return; }
    setForm({ ...form, body }); setError("");
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(start + token.length, start + token.length); });
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !writable || busy) return;
    const invalid = validateMessageTemplate(form);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(""); setNotice("");
    const { id, ...fields } = form;
    const result = await adminSend<{ template: AdminMessageTemplateRow }>("/api/admin/message-templates", { ...fields, ...(id ? { id } : {}) }, id ? "PATCH" : "POST");
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    selectTemplate(result.data.template);
    setNotice("Plantilla guardada en esta empresa. No se envió ningún mensaje.");
    resource.reload();
  }
  async function deleteTemplate() {
    if (!deleting || busy) return;
    setBusy(true); setError("");
    const result = await adminSend("/api/admin/message-templates", { action: "delete", id: deleting.id });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setDeleting(null); setForm(null); baseRef.current = ""; setNotice("Plantilla eliminada. Los mensajes ya registrados se conservan."); resource.reload();
  }
  const activeRow = form?.id ? templates.find((row) => row.id === form.id) : null;

  return <div className="admin-module-page">
    <ClientesTabs active="mensajes" />
    <AdminModuleContext breadcrumb="Clientes / Mensajes" hint="Personalizá las respuestas que tu equipo reutiliza. Las variables se completan al preparar cada mensaje." meta={`${formatNumber(templates.length)} plantillas`} />
    {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
    {error ? <AdminNote tone="error">{error}</AdminNote> : null}
    <div className="admin-message-workspace">
      <div className="admin-message-library">
        <AdminPanel title="Plantillas" icon="mail" meta={formatNumber(rows.length)} action={writable ? <AdminButton icon="plus" size="sm" title="Nueva plantilla" aria-label="Nueva plantilla" onClick={() => requestChange(createTemplate)} disabled={busy} /> : null}>
          <div className="admin-message-controls">
            <SelectField label="Categoría" value={category} onChange={(value) => requestChange(() => { setCategory(value as MessageTemplateCategoryValue); setForm(null); setError(""); setQuery(""); })} options={MESSAGE_TEMPLATE_CATEGORIES.map((value) => ({ value, label: messageTemplateCategoryLabel(value) }))} disabled={busy} size="full" />
            <SearchField label="Buscar plantilla" value={query} onChange={setQuery} placeholder="Título o mensaje…" />
          </div>
          <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload}>
            <div className="admin-message-list" aria-label="Biblioteca de mensajes">
              {rows.length ? rows.map((row) => <AdminButton key={row.id} className="admin-message-template" onClick={() => requestChange(() => selectTemplate(row))} aria-pressed={form?.id === row.id} disabled={busy}>
                <span className="admin-message-template-copy"><strong>{row.title}</strong><small>{row.body}</small></span>
                <AdminBadge tone={row.active ? "ok" : "neutral"}>{row.active ? "Activa" : "Inactiva"}</AdminBadge>
              </AdminButton>) : <AdminEmpty icon="mail" title="Sin plantillas" hint="Probá otra búsqueda o creá una con los modelos disponibles." />}
            </div>
          </AdminDataState>
        </AdminPanel>
      </div>
      <div className="admin-message-editor">
        <AdminPanel title={form?.id ? "Personalizar mensaje" : "Nuevo mensaje"} icon="edit" meta={dirty ? "Sin guardar" : undefined}>
          {form ? <form id={formId} className="admin-form admin-message-fields" onSubmit={save} aria-busy={busy || undefined}>
            <TextField label="Nombre de la plantilla" value={form.title} onChange={(title) => setForm({ ...form, title })} required minLength={2} maxLength={MESSAGE_TEMPLATE_TITLE_MAX} disabled={!writable || busy} size="full" />
            {writable && models.length ? <SelectField label="Modelo de referencia" value={modelKey} onChange={(key) => requestChange(() => applyModel(key))} options={[{ value: "", label: "Elegí un modelo…" }, ...models.map((row) => ({ value: row.key, label: row.title }))]} disabled={busy} hint="Carga un texto de ejemplo; recién se guarda al confirmar." size="full" /> : null}
            <TextAreaField label="Mensaje" value={form.body} onChange={(body) => setForm({ ...form, body })} textareaRef={messageRef} required rows={11} maxLength={MESSAGE_TEMPLATE_BODY_MAX} disabled={!writable || busy} wide hint={`${formatNumber(form.body.length)} / ${formatNumber(MESSAGE_TEMPLATE_BODY_MAX)} caracteres`} />
            <div className="admin-message-variables"><span className="admin-field-label">Insertar variable</span><div className="admin-var-chips">
              {messageTemplateVariablesOf(form.category).map((variable) => <AdminButton key={variable.key} size="sm" title={`${variable.label}: ${variable.hint}`} aria-label={`Insertar ${variable.label}`} onClick={() => insertVariable(variable.key)} disabled={!writable || busy}>{`{{${variable.key}}}`}</AdminButton>)}
            </div><span className="admin-field-hint">Se inserta donde está el cursor. Los datos reales se completan al preparar el envío.</span></div>
            <SwitchField label="Disponible al preparar mensajes" checked={form.active} onChange={(active) => setForm({ ...form, active })} disabled={!writable || busy} wide />
            {writable ? <div className="admin-message-actions">
              <AdminButton type="submit" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={!dirty}>Guardar cambios</AdminButton>
              {model ? <AdminButton icon="refresh" onClick={() => setPendingChange(() => () => applyModel(model.key))} disabled={busy}>Restaurar texto</AdminButton> : null}
              {activeRow ? <AdminButton icon="trash" title="Eliminar plantilla" aria-label="Eliminar plantilla" onClick={() => setDeleting(activeRow)} disabled={busy} /> : null}
            </div> : <AdminNote>Solo lectura. Tu rol puede consultar esta categoría.</AdminNote>}
            {activeRow ? <span className="admin-field-hint">Última edición: {formatDateTime(activeRow.updatedAt)}{activeRow.updatedByName ? ` · ${activeRow.updatedByName}` : ""}</span> : null}
          </form> : <div className="admin-message-placeholder"><AdminEmpty icon="edit" title="Elegí una plantilla" hint="Seleccioná un mensaje para verlo y personalizarlo." />{writable ? <AdminButton icon="plus" onClick={createTemplate}>Nueva plantilla</AdminButton> : null}</div>}
        </AdminPanel>
      </div>
      <div className="admin-message-preview-column">
        <AdminPanel title="Vista previa" icon="eye" meta="Datos de ejemplo">
          <div className="admin-message-preview-content">
            {form ? preview?.ok ? <pre className="admin-message-preview">{preview.text}</pre> : <AdminNote tone="error">{preview?.error ?? "Escribí el mensaje para ver el resultado."}</AdminNote> : <AdminEmpty icon="eye" title="El mensaje aparecerá acá" />}
            <AdminNote>Esta vista usa datos ficticios. Guardar personaliza la plantilla de tu empresa; no envía WhatsApp ni correo.</AdminNote>
          </div>
        </AdminPanel>
      </div>
    </div>
    {pendingChange ? <AdminConfirmDialog title="Reemplazar edición" icon="edit" message="Se reemplazarán los cambios actuales del editor. Los guardados de la empresa se conservan hasta que pulses Guardar cambios." confirmLabel="Continuar" onConfirm={() => { const action = pendingChange; setPendingChange(null); action(); }} onClose={() => setPendingChange(null)} /> : null}
    {deleting ? <AdminConfirmDialog title={`Eliminar plantilla · ${deleting.title}`} icon="trash" danger message="Se elimina esta plantilla de la empresa. Los mensajes ya registrados en la auditoría no cambian." confirmLabel="Eliminar plantilla" busy={busy} error={error} onConfirm={() => void deleteTemplate()} onClose={() => setDeleting(null)} /> : null}
  </div>;
}
