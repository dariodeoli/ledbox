"use client";

import { useState } from "react";
import { CLIENT_LINK_MESSAGES, contactPhoneValid, instagramValid, websiteValid } from "@/lib/admin-format";
import { adminSend } from "@/lib/admin-api";
import { canWriteClients } from "@/lib/admin-policy";
import { useAdminSession } from "../AdminShell";
import type { AdminClientOption, AdminClientContact } from "@/lib/admin-types";
import { emailValid, FIELD_LIMITS, FIELD_MESSAGES, personNameValid } from "@/lib/field-rules";
import { AdminButton, AdminDialog, AdminDisclosure, AdminNote } from "../AdminUI";
import { CityField, EmailField, PhoneField, SegmentedField, TextField } from "../AdminFields";
import { locationLinkValid } from "./OperationQuickRules";
import { ClientFiscalFields } from "./ClientFiscalFields";
import type { AdminClientRucSnapshot } from "@/lib/admin-types";

/** Alta/edición única de cliente (#173): fantasía principal y datos opcionales
 * plegados. Eventos y Presupuestos reutilizan el mismo formulario. name/company
 * históricos se conservan separados de legalName y de los contactos humanos. */

export type ClientQuickValues = {
  tradeName: string;
  legalName: string;
  billingEmail: string;
  city: string;
  department: string;
  address: string;
  addressReference: string;
  locationUrl: string;
  contacts: ClientContactValues[];
  rucSnapshot: AdminClientRucSnapshot | null;
  rucConfirmationToken: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  type: string;
  ruc: string;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  instagram: string;
  whatsapp: string;
};

export type ClientContactValues = AdminClientContact;

export const EMPTY_CLIENT_QUICK: ClientQuickValues = {
  tradeName: "",
  legalName: "",
  billingEmail: "",
  city: "",
  department: "",
  address: "",
  addressReference: "",
  locationUrl: "",
  contacts: [],
  rucSnapshot: null,
  rucConfirmationToken: "",
  name: "",
  phone: "",
  email: "",
  company: "",
  type: "FINAL",
  ruc: "",
  contactName: "",
  contactRole: "",
  contactPhone: "",
  contactEmail: "",
  website: "",
  instagram: "",
  whatsapp: "",
};

/** Avisos del front con el mismo mensaje que revalida el API (regla única). */
export type ClientQuickErrors = {
  tradeName: string | null;
  billingEmail: string | null;
  locationUrl: string | null;
  contacts: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  instagram: string | null;
  whatsapp: string | null;
};

export function clientQuickErrors(values: ClientQuickValues): ClientQuickErrors {
  return {
    tradeName: values.tradeName.length > 200 ? "El nombre comercial admite hasta 200 caracteres." : null,
    billingEmail: values.billingEmail && !emailValid(values.billingEmail) ? FIELD_MESSAGES.email : null,
    locationUrl: values.locationUrl && !locationLinkValid(values.locationUrl) ? "Usá un enlace http o https sin credenciales." : null,
    contacts: values.contacts.length > 20 ? "Podés cargar hasta 20 contactos." : values.contacts.some((contact) =>
      !personNameValid(contact.name) || (contact.phone && !contactPhoneValid(contact.phone)) || (contact.email && !emailValid(contact.email)))
      ? "Revisá el nombre, teléfono y correo de los contactos." : null,
    // name histórico también es texto empresarial: sin validador de persona.
    name: values.name.length > 200 ? "El nombre registrado admite hasta 200 caracteres." : null,
    phone: values.phone && !contactPhoneValid(values.phone) ? FIELD_MESSAGES.phone : null,
    email: values.email && !emailValid(values.email) ? FIELD_MESSAGES.email : null,
    contactPhone: values.contactPhone && !contactPhoneValid(values.contactPhone) ? FIELD_MESSAGES.phone : null,
    contactEmail: values.contactEmail && !emailValid(values.contactEmail) ? FIELD_MESSAGES.email : null,
    website: values.website && !websiteValid(values.website) ? CLIENT_LINK_MESSAGES.website : null,
    instagram: values.instagram && !instagramValid(values.instagram) ? CLIENT_LINK_MESSAGES.instagram : null,
    whatsapp: values.whatsapp && !contactPhoneValid(values.whatsapp) ? FIELD_MESSAGES.phone : null,
  };
}

/** Una serialización para la ficha completa y el alta rápida; vacío limpia opcionales. */
export function clientQuickPayload(values: ClientQuickValues) {
  return {
    ...values,
    name: values.name.trim() || undefined,
    // Leé el snapshot del servidor; el navegador sólo envía el token confirmado.
    rucSnapshot: undefined,
    rucConfirmationToken: values.rucConfirmationToken || undefined,
    confirmRuc: values.rucConfirmationToken ? true : undefined,
    tradeName: values.tradeName.trim() || null,
    legalName: values.legalName.trim() || null,
    billingEmail: values.billingEmail || null,
    city: values.city || null,
    department: values.department || null,
    address: values.address || null,
    addressReference: values.addressReference || null,
    locationUrl: values.locationUrl || null,
    contacts: values.contacts.map((contact) => ({ name: contact.name.trim(), role: contact.role?.trim() || null, phone: contact.phone || null, email: contact.email || null })),
    company: values.company || null,
    ruc: values.ruc || null,
    phone: values.phone || null,
    email: values.email || null,
    contactName: values.contactName || null,
    contactRole: values.contactRole || null,
    contactPhone: values.contactPhone || null,
    contactEmail: values.contactEmail || null,
    website: values.website || null,
    instagram: values.instagram || null,
    whatsapp: values.whatsapp || null,
  };
}

export function clientQuickFirstError(errors: ClientQuickErrors): string {
  return Object.values(errors).find(Boolean) ?? "";
}

/**
 * Los campos del alta mínima. `children` se dibuja dentro de «Más datos»
 * (notas y logo en Clientes); el diálogo del evento no agrega nada.
 */
export function ClientQuickFields({
  values,
  onChange,
  errors,
  autoFocus,
  moreOpen,
  children,
}: {
  values: ClientQuickValues;
  onChange: (patch: Partial<ClientQuickValues>) => void;
  errors?: ClientQuickErrors;
  /** Foco automático en el Nombre al abrir el alta (issue #106). */
  autoFocus?: boolean;
  /** «Más datos» abierto de entrada (al editar, para no esconder lo cargado). */
  moreOpen?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <TextField
        label="Nombre fantasía / comercial"
        required={!values.name.trim()}
        autoFocus={autoFocus}
        maxLength={200}
        value={values.tradeName}
        onChange={(tradeName) => onChange({ tradeName })}
        placeholder="Ej.: Samsung Paraguay"
        hint="Identidad principal de la cartera; independiente de la razón social y del contacto."
        error={errors?.tradeName}
      />
      <PhoneField
        label="Teléfono"
        hint="Opcional · con código de país"
        value={values.phone}
        onChange={(value) => onChange({ phone: value })}
        error={errors?.phone ?? null}
      />
      <EmailField
        label="Correo"
        value={values.email}
        onChange={(value) => onChange({ email: value })}
        placeholder="contacto@empresa.com"
        error={errors?.email ?? null}
      />
      <AdminDisclosure title="Más datos" hint="datos fiscales, ubicación y contactos" defaultOpen={moreOpen}>
        {values.name ? <TextField label="Nombre histórico" maxLength={200} value={values.name}
          onChange={(name) => onChange({ name })} error={errors?.name ?? null}
          hint="Se conserva sin convertirlo en razón social ni persona de contacto." /> : null}
        <TextField
          label="Empresa"
          maxLength={FIELD_LIMITS.company}
          value={values.company}
          onChange={(value) => onChange({ company: value })}
          placeholder="Ej.: Samsung Paraguay"
          hint="Dato histórico de empresa; no implica razón social."
        />
        <SegmentedField
          label="Tipo"
          value={values.type}
          onChange={(value) => onChange({ type: value })}
          options={[
            { value: "FINAL", label: "Cliente final" },
            { value: "RESELLER", label: "Mayorista / revendedor" },
          ]}
        />
        <ClientFiscalFields ruc={values.ruc} legalName={values.legalName} snapshot={values.rucSnapshot}
          confirmed={Boolean(values.rucConfirmationToken)} onChange={onChange} />
        <EmailField label="Correo de facturación" value={values.billingEmail} onChange={(billingEmail) => onChange({ billingEmail })} error={errors?.billingEmail} />
        <CityField label="Ciudad" value={values.city} onChange={(city) => onChange({ city, department: "" })}
          onSelect={(city, department) => onChange({ city, department })} hint="Seleccioná una ciudad para completar departamento o escribí a mano." />
        <TextField label="Departamento" maxLength={120} value={values.department} onChange={(department) => onChange({ department })} hint="Podés completarlo a mano." />
        <TextField label="Dirección" maxLength={300} value={values.address} onChange={(address) => onChange({ address })} />
        <TextField label="Referencia de dirección" maxLength={400} value={values.addressReference} onChange={(addressReference) => onChange({ addressReference })} />
        <TextField label="Enlace de ubicación" maxLength={2000} inputMode="url" value={values.locationUrl} onChange={(locationUrl) => onChange({ locationUrl })} error={errors?.locationUrl} placeholder="https://…" />
        <TextField
          label="Nombre del encargado"
          maxLength={FIELD_LIMITS.name}
          value={values.contactName}
          onChange={(value) => onChange({ contactName: value })}
          placeholder="Ej.: María González"
        />
        <TextField
          label="Cargo"
          maxLength={FIELD_LIMITS.name}
          value={values.contactRole}
          onChange={(value) => onChange({ contactRole: value })}
          placeholder="Ej.: Gerenta de marketing"
        />
        <PhoneField
          label="Teléfono directo"
          value={values.contactPhone}
          onChange={(value) => onChange({ contactPhone: value })}
          error={errors?.contactPhone ?? null}
        />
        <EmailField
          label="Correo directo"
          value={values.contactEmail}
          onChange={(value) => onChange({ contactEmail: value })}
          error={errors?.contactEmail ?? null}
        />
        <TextField
          label="Sitio web"
          maxLength={200}
          value={values.website}
          onChange={(value) => onChange({ website: value })}
          placeholder="empresa.com.py"
          inputMode="url"
          error={errors?.website ?? null}
          hint="Sin «https://» también funciona."
        />
        <TextField
          label="Instagram"
          maxLength={64}
          value={values.instagram}
          onChange={(value) => onChange({ instagram: value })}
          placeholder="@empresa"
          error={errors?.instagram ?? null}
          hint="El usuario con arroba o el link del perfil."
        />
        <PhoneField
          label="WhatsApp"
          hint="Solo si difiere del teléfono general"
          value={values.whatsapp}
          onChange={(value) => onChange({ whatsapp: value })}
          error={errors?.whatsapp ?? null}
        />
        <div className="admin-form-group admin-field--wide">
          <h3 className="admin-form-group-title">Contactos por función</h3>
          {values.contacts.map((contact, index) => (
            <div className="admin-form-group" key={index}>
              <TextField label={`Contacto ${index + 1} · nombre`} required maxLength={120} value={contact.name}
                onChange={(name) => onChange({ contacts: values.contacts.map((current, at) => at === index ? { ...current, name } : current) })}
                error={contact.name && !personNameValid(contact.name) ? FIELD_MESSAGES.name : null} />
              <TextField label={`Contacto ${index + 1} · función`} maxLength={120} value={contact.role ?? ""}
                onChange={(role) => onChange({ contacts: values.contacts.map((current, at) => at === index ? { ...current, role } : current) })} />
              <PhoneField label={`Contacto ${index + 1} · teléfono`} value={contact.phone ?? ""}
                onChange={(phone) => onChange({ contacts: values.contacts.map((current, at) => at === index ? { ...current, phone } : current) })}
                error={contact.phone && !contactPhoneValid(contact.phone) ? FIELD_MESSAGES.phone : null} />
              <EmailField label={`Contacto ${index + 1} · correo`} value={contact.email ?? ""}
                onChange={(email) => onChange({ contacts: values.contacts.map((current, at) => at === index ? { ...current, email } : current) })}
                error={contact.email && !emailValid(contact.email) ? FIELD_MESSAGES.email : null} />
              <AdminButton type="button" icon="trash" aria-label={`Quitar contacto ${index + 1}`} onClick={() => onChange({ contacts: values.contacts.filter((_, at) => at !== index) })}>Quitar contacto</AdminButton>
            </div>
          ))}
          {errors?.contacts ? <AdminNote tone="error">{errors.contacts}</AdminNote> : null}
          <AdminButton type="button" icon="plus" disabled={values.contacts.length >= 20} onClick={() => onChange({ contacts: [...values.contacts, { name: "", role: null, phone: null, email: null }] })}>Agregar contacto</AdminButton>
        </div>
        {children}
      </AdminDisclosure>
    </>
  );
}

/**
 * «+ Nuevo cliente» del evento (issue #106, patrón de #88): el mismo alta
 * mínima dentro del diálogo, con el nombre que se venía tipeando. Al crear,
 * el llamador lo deja elegido en el evento.
 */
export function ClientQuickDialog({
  initialName = "",
  onClose,
  onCreated,
}: {
  /** Nombre tipeado en el selector, para no volver a escribirlo. */
  initialName?: string;
  onClose: () => void;
  onCreated: (client: AdminClientOption) => void;
}) {
  const [values, setValues] = useState<ClientQuickValues>({ ...EMPTY_CLIENT_QUICK, tradeName: initialName });
  const { role } = useAdminSession();
  const writable = canWriteClients(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errors = clientQuickErrors(values);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !writable) return;
    if (!values.name.trim() && !values.tradeName.trim()) {
      setError(FIELD_MESSAGES.name);
      return;
    }
    const firstError = clientQuickFirstError(errors);
    if (firstError) {
      setError(firstError);
      return;
    }
    setBusy(true);
    setError("");
    // Mismo contrato del alta completa; acá no se cargan notas.
    const result = await adminSend<{ client?: AdminClientOption }>("/api/admin/clients", clientQuickPayload(values));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const created = result.data.client;
    if (!created?.id) {
      // El alta pudo quedar guardada: se avisa sin inventar una selección.
      setError("El cliente se guardó, pero no recibimos su id: recargá Eventos y elegilo de nuevo.");
      return;
    }
    onCreated(created);
  }

  if (!writable) return <AdminDialog title="Nuevo cliente" icon="clients" onClose={onClose}><AdminNote>No tenés permiso para crear clientes.</AdminNote></AdminDialog>;

  return (
    <AdminDialog title="Nuevo cliente" icon="clients" onClose={onClose}>
      <p className="admin-dialog-text">
        Alta mínima: al crearlo queda elegido en el evento. El resto de la ficha se completa después en Clientes.
      </p>
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <ClientQuickFields
          values={values}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          errors={errors}
          autoFocus
        />
        {error ? <AdminNote tone="error">{error}</AdminNote> : null}
        <div className="admin-dialog-foot">
          <span className="admin-dialog-spacer" />
          <AdminButton icon="close" type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="submit" busy={busy}>
            Crear cliente
          </AdminButton>
        </div>
      </form>
    </AdminDialog>
  );
}
