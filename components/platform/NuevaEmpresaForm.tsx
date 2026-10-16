"use client";
import { Input as SharedInput, Select as SharedSelect, EmailField as SharedEmailField } from "owncoding-ui";


import { useActionState, useRef, useState } from "react";
import { MAX_INVITEES, ORG_NAME_MAX, ORG_SLUG_MAX, suggestOrgSlug, type AltaFormState, type InviteeRole } from "@/lib/platform/alta-empresa";

/** Server-action form using the same shared controls as the company panel.
 * Native names and repeated invitee fields remain the transport contract. */
const INITIAL: AltaFormState = { error: null, fieldErrors: {}, values: { name: "", slug: "", planCode: "", invitees: [{ email: "", role: "OWNER" }] } };

type Row = { key: number; email: string; role: InviteeRole };

type CrearAction = (previous: AltaFormState, formData: FormData) => Promise<AltaFormState>;

/** La server action llega como prop desde la página (servidor): el cliente no importa guard ni base. */
export function NuevaEmpresaForm({ plans, createAction }: Readonly<{ plans: Array<{ code: string; name: string }>; createAction: CrearAction }>) {
  const [state, action, pending] = useActionState(createAction, INITIAL);
  const [name, setName] = useState(state.values.name);
  const [slug, setSlug] = useState(state.values.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>(() =>
    (state.values.invitees.length ? state.values.invitees : INITIAL.values.invitees).map((invitee, index) => ({ key: index, email: invitee.email, role: invitee.role || "OWNER" })),
  );
  const errors = state.fieldErrors;
  if (nextKey.current <= rows.length) nextKey.current = rows.length + 1;

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function field(id: string, label: string, error: string | undefined, hint: string | undefined, control: React.ReactNode) {
    return (
      <div className="admin-field">
        <label htmlFor={id}>{label} <span className="admin-field-req" aria-hidden="true">*</span></label>
        {control}
        {hint && !error ? <p className="admin-field-hint" id={`${id}-hint`}>{hint}</p> : null}
        {error ? <p className="platform-field-error" id={`${id}-error`} role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <form className="platform-form" action={action} noValidate>
      {state.error ? <p className="platform-notice" role="alert">{state.error}</p> : null}
      {field("alta-name", "Nombre de la empresa", errors.name, undefined,
        <SharedInput id="alta-name" name="name" type="text" required maxLength={ORG_NAME_MAX} autoComplete="off" value={name}
          aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "alta-name-error" : undefined}
          onChange={(event) => { setName(event.target.value); if (!slugTouched) setSlug(suggestOrgSlug(event.target.value)); }} />)}
      {field("alta-slug", "Identificador (slug)", errors.slug, "Va en las direcciones públicas de la empresa. Se sugiere desde el nombre y debe ser único.",
        <SharedInput id="alta-slug" name="slug" type="text" required maxLength={ORG_SLUG_MAX} autoComplete="off" autoCapitalize="none" spellCheck={false} value={slug}
          aria-invalid={errors.slug ? true : undefined} aria-describedby={errors.slug ? "alta-slug-error" : "alta-slug-hint"}
          onChange={(event) => { setSlugTouched(true); setSlug(event.target.value.toLowerCase()); }} />)}
      {field("alta-plan", "Plan", errors.planCode, undefined,
        <SharedSelect id="alta-plan" name="planCode" required defaultValue={state.values.planCode}
          aria-invalid={errors.planCode ? true : undefined} aria-describedby={errors.planCode ? "alta-plan-error" : undefined}>
          <option value="">Elegí un plan</option>
          {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
        </SharedSelect>)}

      <fieldset className="platform-invitees">
        <legend>Personas a invitar <span className="admin-field-req" aria-hidden="true">*</span></legend>
        <p className="admin-field-hint">Cada una recibe un link por correo, vigente 7 días, para crear su acceso. No se carga ninguna contraseña.</p>
        {errors.invitees ? <p className="platform-field-error" role="alert">{errors.invitees}</p> : null}
        {rows.map((row, index) => {
          const rowError = errors.inviteeRows?.[index];
          return (
            <div className="platform-invitee" key={row.key}>
              <div className="admin-field">
                <label htmlFor={`alta-email-${row.key}`}>Correo {index + 1}</label>
                <SharedEmailField id={`alta-email-${row.key}`} name="inviteeEmail" inputMode="email" autoComplete="off" value={row.email}
                  aria-invalid={rowError ? true : undefined} aria-describedby={rowError ? `alta-email-${row.key}-error` : undefined}
                  onChange={(value) => update(row.key, { email: value })} />
              </div>
              <div className="admin-field">
                <label htmlFor={`alta-role-${row.key}`}>Rol</label>
                <SharedSelect id={`alta-role-${row.key}`} name="inviteeRole" value={row.role} onChange={(event) => update(row.key, { role: event.target.value as InviteeRole })}>
                  <option value="OWNER">Dueño</option>
                  <option value="ADMIN">Administrador</option>
                </SharedSelect>
              </div>
              <button type="button" className="admin-btn platform-btn" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                disabled={rows.length === 1} aria-label={`Quitar el correo ${index + 1}`}>Quitar</button>
              {rowError ? <p className="platform-field-error platform-invitee-error" id={`alta-email-${row.key}-error`} role="alert">{rowError}</p> : null}
            </div>
          );
        })}
        <div>
          <button type="button" className="admin-btn platform-btn" disabled={rows.length >= MAX_INVITEES}
            onClick={() => { const key = nextKey.current++; setRows((current) => [...current, { key, email: "", role: "ADMIN" }]); }}>
            Agregar persona
          </button>
        </div>
      </fieldset>

      <div className="platform-form-actions">
        <button type="submit" className="admin-btn admin-btn--primary platform-btn" disabled={pending}>{pending ? "Creando…" : "Crear empresa e invitar"}</button>
        <a className="admin-btn platform-btn" href="/superadmin/empresas">Cancelar</a>
      </div>
    </form>
  );
}
