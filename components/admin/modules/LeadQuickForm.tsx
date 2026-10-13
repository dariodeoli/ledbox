"use client";

import { useId, useState } from "react";
import { adminSend, requestAdminRefresh } from "@/lib/admin-api";
import { canWriteClients } from "@/lib/admin-policy";
import { emailValid, FIELD_MESSAGES, personNameValid, phoneValid } from "@/lib/field-rules";
import { useAdminSession } from "../AdminShell";
import { AdminButton, AdminDialog, AdminDialogSection, AdminNote } from "../AdminUI";
import { CheckboxField, EmailField, PhoneField, SelectField, TextAreaField, TextField } from "../AdminFields";

/**
 * Alta manual de un lead («Nuevo lead», Resumen y Leads): una consulta que llegó
 * por llamada, WhatsApp o referido y no pasó por el formulario del sitio. Pide lo
 * mínimo (nombre, teléfono y correo, que el API revalida) y deja empresa, canal y
 * nota como opcionales. Queda en estado «Nuevo» en la empresa activa.
 */

const SOURCE_OPTIONS = [
  { value: "llamada", label: "Llamada" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "referido", label: "Referido" },
  { value: "evento", label: "Evento o feria" },
  { value: "otro", label: "Otro" },
];

const EMPTY = { name: "", phone: "", email: "", company: "", source: "whatsapp", message: "", consent: false };

export function LeadQuickDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [values, setValues] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const formId = useId();
  const { role } = useAdminSession();
  const writable = canWriteClients(role);
  const dirty = JSON.stringify(values) !== JSON.stringify(EMPTY);

  const errors = {
    name: personNameValid(values.name) ? null : FIELD_MESSAGES.name,
    phone: phoneValid(values.phone) ? null : FIELD_MESSAGES.phone,
    email: emailValid(values.email) ? null : FIELD_MESSAGES.email,
    consent: values.consent ? null : "Marcá que el contacto pidió que lo llamemos o le cotizemos.",
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !writable) return;
    setSubmitted(true);
    const first = errors.name ?? errors.phone ?? errors.email ?? errors.consent;
    if (first) {
      setError(first);
      return;
    }
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/leads", {
      name: values.name.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      company: values.company.trim(),
      message: values.message.trim(),
      source: values.source,
      consent: values.consent,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // El contador de Leads del menú y «Para hacer hoy» salen de datos vivos.
    requestAdminRefresh();
    onCreated(values.name.trim());
  }

  if (!writable) {
    return (
      <AdminDialog title="Nuevo lead" icon="leads" onClose={onClose}>
        <AdminNote>No tenés permiso para cargar leads.</AdminNote>
      </AdminDialog>
    );
  }

  return (
    <AdminDialog
      title="Nuevo lead"
      icon="leads"
      description="Una consulta que llegó por fuera del sitio. Queda como «Nuevo» para contactarla."
      size="md"
      dirty={dirty}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="submit" form={formId} busy={busy} busyLabel="Guardando…">
            Crear lead
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} noValidate>
        <AdminDialogSection title="Contacto">
          <TextField
            label="Nombre"
            value={values.name}
            onChange={(name) => setValues((current) => ({ ...current, name }))}
            maxLength={120}
            required
            wide
            autoFocus
            autoComplete="off"
            error={submitted ? errors.name : null}
          />
          <PhoneField
            label="Teléfono"
            value={values.phone}
            onChange={(phone) => setValues((current) => ({ ...current, phone }))}
            required
            error={submitted ? errors.phone : null}
          />
          <EmailField
            label="Correo"
            value={values.email}
            onChange={(email) => setValues((current) => ({ ...current, email }))}
            required
            error={submitted ? errors.email : null}
          />
        </AdminDialogSection>
        <AdminDialogSection title="Consulta">
          <SelectField
            label="¿Cómo llegó?"
            value={values.source}
            onChange={(source) => setValues((current) => ({ ...current, source }))}
            options={SOURCE_OPTIONS}
          />
          <TextAreaField
            label="Qué pidió"
            value={values.message}
            onChange={(message) => setValues((current) => ({ ...current, message }))}
            maxLength={400}
            rows={3}
            optional
            wide
          />
          <CheckboxField
            checked={values.consent}
            onChange={(consent) => setValues((current) => ({ ...current, consent }))}
            text="El contacto pidió que lo llamemos o le cotizemos"
          />
        </AdminDialogSection>
        <AdminDialogSection title="Más opciones" collapsible hint="empresa">
          <TextField
            label="Empresa"
            value={values.company}
            onChange={(company) => setValues((current) => ({ ...current, company }))}
            maxLength={160}
            optional
            autoComplete="off"
          />
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}
