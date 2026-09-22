"use client";

import { useMemo, useRef, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatNumber, messageTemplateCategoryLabel } from "@/lib/admin-format";
import { canWriteTemplateCategory, matchesQuery } from "@/lib/admin-policy";
import {
  MESSAGE_TEMPLATE_CATEGORIES,
  type AdminMessageTemplateRow,
  type MessageTemplateCategoryValue,
} from "@/lib/admin-types";
import {
  MESSAGE_TEMPLATE_BODY_MAX,
  MESSAGE_TEMPLATE_TITLE_MAX,
  messageTemplateVariablesOf,
  previewMessageTemplate,
  validateMessageTemplate,
} from "@/lib/server/message-templates";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminDialog,
  AdminEmpty,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { SearchField, SelectField, SwitchField, TextAreaField, TextField } from "../AdminFields";

/**
 * Plantillas de mensajes de WhatsApp por contexto (issue #35).
 *
 * Subtabs por categoría con contador, tabla densa (Plantilla · Mensaje · Estado
 * · Acciones) y alta/edición en diálogo con chips de variables y vista previa
 * con datos de ejemplo (el render es el mismo del servidor:
 * `lib/server/message-templates.ts`). VIEWER solo lee; OWNER/ADMIN administran
 * todas las categorías y FINANCE/OPERATIONS solo cobranzas/eventos.
 */

type TemplateForm = {
  id: string;
  category: MessageTemplateCategoryValue;
  title: string;
  body: string;
  active: boolean;
};

const EMPTY_FORM: TemplateForm = { id: "", category: "budget", title: "", body: "", active: true };

export function PlantillasModule() {
  const { role } = useAdminSession();
  const templatesResource = useAdminResource("/api/admin/message-templates", (payload) => payload.templates ?? []);
  const [category, setCategory] = useState<MessageTemplateCategoryValue>("budget");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [rowError, setRowError] = useState("");
  const [deleting, setDeleting] = useState<AdminMessageTemplateRow | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const templates = useMemo<AdminMessageTemplateRow[]>(() => templatesResource.data ?? [], [templatesResource.data]);

  const counts = useMemo(() => {
    const byCategory = new Map<MessageTemplateCategoryValue, number>();
    for (const template of templates) byCategory.set(template.category, (byCategory.get(template.category) ?? 0) + 1);
    return byCategory;
  }, [templates]);

  const rows = useMemo(
    () =>
      templates
        .filter((template) => template.category === category)
        .filter((template) => matchesQuery(query, [template.title, template.body]))
        // El orden del API es dentro de la categoría; acá se ordena por si el
        // equipo cambió el orden a mano.
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "es")),
    [templates, category, query],
  );

  const totals = useMemo(
    () => ({
      total: templates.length,
      active: templates.filter((template) => template.active).length,
      inactive: templates.filter((template) => !template.active).length,
      categories: new Set(templates.map((template) => template.category)).size,
    }),
    [templates],
  );

  const canCreate = canWriteTemplateCategory(role, category);
  const writableCategories = MESSAGE_TEMPLATE_CATEGORIES.filter((value) => canWriteTemplateCategory(role, value));
  const preview = useMemo(
    () => (form ? previewMessageTemplate(form.body, form.category) : null),
    [form],
  );

  function openCreate() {
    setFormError("");
    setNotice("");
    setForm({ ...EMPTY_FORM, category });
  }

  function openEdit(template: AdminMessageTemplateRow) {
    setFormError("");
    setNotice("");
    setForm({
      id: template.id,
      category: template.category,
      title: template.title,
      body: template.body,
      active: template.active,
    });
  }

  /** Inserta la variable en el cursor del mensaje (o al final si no hay foco). */
  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const node = messageRef.current;
    const start = node?.selectionStart ?? form?.body.length ?? 0;
    const end = node?.selectionEnd ?? start;
    setForm((current) => {
      if (!current) return current;
      const body = `${current.body.slice(0, start)}${token}${current.body.slice(end)}`.slice(0, MESSAGE_TEMPLATE_BODY_MAX);
      const cursor = Math.min(start + token.length, body.length);
      requestAnimationFrame(() => {
        if (!node) return;
        node.focus();
        node.setSelectionRange(cursor, cursor);
      });
      return { ...current, body };
    });
  }

  async function submitTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const error = validateMessageTemplate({ title: form.title, body: form.body, category: form.category });
    if (error) {
      setFormError(error);
      return;
    }
    setBusy(true);
    setFormError("");
    const payload = { title: form.title, body: form.body, category: form.category, active: form.active };
    const result = form.id
      ? await adminSend("/api/admin/message-templates", { id: form.id, ...payload }, "PATCH")
      : await adminSend("/api/admin/message-templates", payload);
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice(form.id ? `Plantilla «${form.title}» actualizada.` : `Plantilla «${form.title}» cargada.`);
    setForm(null);
    templatesResource.reload();
  }

  async function toggleActive(template: AdminMessageTemplateRow) {
    setBusyId(template.id);
    setRowError("");
    setNotice("");
    const result = await adminSend("/api/admin/message-templates", { id: template.id, active: !template.active }, "PATCH");
    setBusyId("");
    if (!result.ok) {
      setRowError(result.error);
      return;
    }
    setNotice(template.active ? `Plantilla «${template.title}» desactivada.` : `Plantilla «${template.title}» activada.`);
    templatesResource.reload();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setRowError("");
    const result = await adminSend("/api/admin/message-templates", { action: "delete", id: deleting.id });
    setBusy(false);
    if (!result.ok) {
      setDeleting(null);
      setRowError(result.error);
      return;
    }
    setNotice(`Plantilla «${deleting.title}» borrada.`);
    setDeleting(null);
    templatesResource.reload();
  }

  /** Categorías que el rol puede administrar; en edición se conserva la actual. */
  const categoryOptions = useMemo(() => {
    const allowed = form?.id
      ? writableCategories.includes(form.category)
        ? writableCategories
        : [...writableCategories, form.category]
      : writableCategories;
    return allowed.map((value) => ({ value, label: messageTemplateCategoryLabel(value) }));
  }, [writableCategories, form?.id, form?.category]);

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de plantillas">
        <AdminKpi label="Plantillas" value={formatNumber(totals.total)} note="de mensajes de WhatsApp" />
        <AdminKpi label="Activas" value={formatNumber(totals.active)} note="disponibles para enviar" tone="ok" />
        <AdminKpi label="Inactivas" value={formatNumber(totals.inactive)} note="ocultas en los módulos" />
        <AdminKpi label="Categorías" value={formatNumber(totals.categories)} note={`de ${formatNumber(MESSAGE_TEMPLATE_CATEGORIES.length)}`} tone="accent" />
      </section>

      <nav className="admin-subtabs" aria-label="Categorías de plantillas">
        {MESSAGE_TEMPLATE_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            className="admin-subtab"
            data-active={value === category ? "true" : undefined}
            aria-pressed={value === category}
            onClick={() => {
              setCategory(value);
              setForm(null);
              setFormError("");
            }}
          >
            {messageTemplateCategoryLabel(value)}
            <span className="admin-subtab-count">{formatNumber(counts.get(value) ?? 0)}</span>
          </button>
        ))}
      </nav>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar plantillas"
          placeholder="Buscar por título o mensaje…"
        />
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {rowError ? <AdminNote tone="error">{rowError}</AdminNote> : null}

      <AdminPanel
        title={`Plantillas de ${messageTemplateCategoryLabel(category).toLowerCase()}`}
        meta={`${formatNumber(rows.length)} de ${formatNumber(counts.get(category) ?? 0)}`}
        action={
          canCreate ? (
            <AdminButton variant="primary" icon="plus" onClick={openCreate} aria-expanded={form !== null && !form.id}>
              Nueva plantilla
            </AdminButton>
          ) : null
        }
      >
        <AdminDataState
          loading={templatesResource.loading}
          error={templatesResource.error}
          onRetry={templatesResource.reload}
          empty={templates.length === 0}
          emptyTitle="Todavía no hay plantillas"
          emptyHint="Cargá la primera plantilla para responder por WhatsApp con el mensaje ya armado."
        >
          {rows.length === 0 ? (
            <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá de categoría." />
          ) : (
            <AdminTable
              view="plantillas"
              label={`Plantillas de ${messageTemplateCategoryLabel(category)}`}
              columns={[
                { label: "Plantilla" },
                { label: "Mensaje" },
                { label: "Estado" },
                { label: "Acciones", end: true },
              ]}
            >
              {rows.map((template) => {
                const writable = canWriteTemplateCategory(role, template.category);
                return (
                  <AdminRow key={template.id}>
                    <AdminCell title={`${template.title} · ${messageTemplateCategoryLabel(template.category)}`}>
                      <strong>{template.title}</strong>
                      {template.updatedByName ? <small className="admin-cell-sub"> · {template.updatedByName}</small> : null}
                    </AdminCell>
                    <AdminCell title={template.body}>{template.body}</AdminCell>
                    <AdminCell>
                      <AdminBadge tone={template.active ? "ok" : "neutral"}>{template.active ? "Activa" : "Inactiva"}</AdminBadge>
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      <span className="admin-actions">
                        {writable ? (
                          <>
                            <AdminButton
                              icon="edit"
                              title={`Editar plantilla: ${template.title}`}
                              aria-label={`Editar plantilla: ${template.title}`}
                              onClick={() => openEdit(template)}
                            />
                            <AdminButton
                              icon="power"
                              busy={busyId === template.id}
                              disabled={Boolean(busyId)}
                              title={template.active ? `Desactivar plantilla: ${template.title}` : `Activar plantilla: ${template.title}`}
                              aria-label={template.active ? `Desactivar plantilla: ${template.title}` : `Activar plantilla: ${template.title}`}
                              onClick={() => void toggleActive(template)}
                            />
                            <AdminButton
                              icon="trash"
                              title={`Borrar plantilla: ${template.title}`}
                              aria-label={`Borrar plantilla: ${template.title}`}
                              onClick={() => {
                                setRowError("");
                                setDeleting(template);
                              }}
                            />
                          </>
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </span>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminDataState>
      </AdminPanel>

      {form ? (
        <AdminDialog title={form.id ? `Editar plantilla · ${form.title}` : "Nueva plantilla"} wide onClose={() => setForm(null)}>
          <form className="admin-template-form" onSubmit={submitTemplate} aria-busy={busy || undefined}>
            <SelectField
              label="Categoría"
              required
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value as MessageTemplateCategoryValue })}
              options={categoryOptions}
              disabled={Boolean(form.id)}
              hint={form.id ? "La categoría no se cambia después de crear la plantilla." : undefined}
            />
            <TextField
              label="Título"
              required
              minLength={2}
              maxLength={MESSAGE_TEMPLATE_TITLE_MAX}
              value={form.title}
              onChange={(value) => setForm({ ...form, title: value })}
              placeholder="Ej.: Recordatorio de pago"
            />
            <SwitchField
              label="Activa"
              checked={form.active}
              onChange={(active) => setForm({ ...form, active })}
              hint="Solo las activas se ofrecen al enviar."
            />
            <TextAreaField
              label="Mensaje"
              wide
              required
              rows={8}
              maxLength={MESSAGE_TEMPLATE_BODY_MAX}
              value={form.body}
              onChange={(value) => setForm({ ...form, body: value })}
              textareaRef={messageRef}
              placeholder="Escribí el mensaje y sumá variables con los chips de abajo."
              hint={`${formatNumber(form.body.length)} de ${formatNumber(MESSAGE_TEMPLATE_BODY_MAX)} caracteres`}
            />

            <div className="admin-field admin-field--wide">
              <span className="admin-field-label">Variables de {messageTemplateCategoryLabel(form.category).toLowerCase()}</span>
              <div className="admin-var-chips">
                {messageTemplateVariablesOf(form.category).map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    className="admin-var-chip"
                    title={`${variable.label}: ${variable.hint}`}
                    onClick={() => insertVariable(variable.key)}
                  >
                    {`{{${variable.key}}}`}
                  </button>
                ))}
              </div>
              <span className="admin-field-hint">
                El chip inserta la variable en el cursor. Al enviar se completa con el dato real; si falta, el envío se
                detiene y se avisa cuál falta.
              </span>
            </div>

            <div className="admin-field admin-field--wide">
              <span className="admin-field-label">Vista previa con datos de ejemplo</span>
              {preview?.ok ? (
                <pre className="admin-message-preview">{preview.text}</pre>
              ) : (
                <AdminNote tone="error">{preview?.error ?? "Escribí el mensaje para ver la vista previa."}</AdminNote>
              )}
            </div>

            {formError ? <AdminNote tone="error">{formError}</AdminNote> : null}

            <div className="admin-dialog-foot">
              <span className="admin-dialog-spacer" />
              <AdminButton type="button" onClick={() => setForm(null)} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" busy={busy}>
                {form.id ? "Guardar cambios" : "Cargar plantilla"}
              </AdminButton>
            </div>
          </form>
        </AdminDialog>
      ) : null}

      {deleting ? (
        <AdminDialog title={`Borrar plantilla · ${deleting.title}`} onClose={() => setDeleting(null)}>
          <AdminNote tone="error">
            Se borra la plantilla «{deleting.title}» de {messageTemplateCategoryLabel(deleting.category).toLowerCase()}. Los
            envíos ya registrados en la auditoría no se tocan.
          </AdminNote>
          <div className="admin-dialog-foot">
            <span className="admin-dialog-spacer" />
            <AdminButton type="button" onClick={() => setDeleting(null)} disabled={busy}>
              Cancelar
            </AdminButton>
            <AdminButton type="button" variant="primary" icon="trash" busy={busy} onClick={() => void confirmDelete()}>
              Borrar plantilla
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}
    </div>
  );
}
