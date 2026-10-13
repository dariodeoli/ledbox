"use client";

import { useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { whatsappHref } from "@/lib/admin-format";
import { TextField } from "../AdminFields";
import { AdminButton, AdminDialog, AdminNote, AdminPanel } from "../AdminUI";

/**
 * «Compartir catálogo mayorista» en la ficha del cliente. El link es privado,
 * identifica al cliente (sin cuentas) y se revoca desde acá. Por seguridad la base
 * guarda solo el hash: el link completo se ve UNA sola vez, al generarlo.
 */

type Status = { active: { createdAt: string; lastUsedAt: string | null } | null; revoked: number };
type CatalogAccessPayload = { access: Status; storeEnabled: boolean; url?: string };

export function ClientCatalogAccess({ clientId, clientName, phone, canEdit }: { clientId: string; clientName: string; phone: string | null; canEdit: boolean }) {
  const base = `/api/admin/clients/${clientId}/catalog-access`;
  const resource = useAdminResource<{ access: Status; storeEnabled: boolean } | null>(base, (payload) => (payload as unknown as CatalogAccessPayload) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const active = resource.data?.access.active ?? null;
  const storeEnabled = resource.data?.storeEnabled ?? false;

  async function generate() {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await adminSend<CatalogAccessPayload>(base, {}, "POST");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFresh(result.data.url ?? null);
    resource.reload();
  }

  async function revoke() {
    setBusy(true);
    setError("");
    const result = await adminSend(base, {}, "DELETE");
    setBusy(false);
    setConfirmRevoke(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFresh(null);
    setNotice("Revocamos el link: ya no abre el catálogo mayorista.");
    resource.reload();
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setNotice("Link copiado.");
    } catch {
      setError("No pudimos copiar; seleccioná el link y copialo a mano.");
    }
  }

  const share = fresh ? whatsappHref(phone, `Hola ${clientName}! Este es tu catálogo mayorista con tus precios: ${fresh}`) : null;

  return (
    <AdminPanel title="Catálogo mayorista" icon="inventory" meta="Link privado del cliente">
      <p className="admin-field-hint">
        Un link privado que muestra los productos y precios mayoristas. No usa cuentas: quien lo abre pide a nombre de este cliente.
      </p>
      {resource.error ? <AdminNote tone="error">{resource.error}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {!resource.loading && !storeEnabled ? (
        <AdminNote tone="warn">La tienda web de la empresa está apagada: el link no abrirá nada hasta que la enciendas en Ajustes → Tienda web.</AdminNote>
      ) : null}
      {fresh ? (
        <div className="admin-catalog-access" data-testid="catalog-access-link">
          <TextField label="Link del catálogo mayorista" value={fresh} onChange={() => undefined} readOnly hint="Guardalo o enviáselo ahora: por seguridad no se vuelve a mostrar." />
          <span className="admin-actions">
            <AdminButton icon="copy" onClick={() => void copy()}>Copiar</AdminButton>
            {share ? (
              <a className="admin-btn" href={share} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>
            ) : null}
          </span>
        </div>
      ) : active ? (
        <p className="admin-note" data-testid="catalog-access-active">
          Link vigente desde el {formatDateTime(active.createdAt)}.{" "}
          {active.lastUsedAt ? `Último uso: ${formatDateTime(active.lastUsedAt)}.` : "Todavía no se usó."} Si lo perdiste, generá uno nuevo: el anterior deja de funcionar.
        </p>
      ) : (
        <p className="admin-note">Este cliente no tiene un link activo.</p>
      )}
      {canEdit ? (
        <span className="admin-actions">
          <AdminButton variant="primary" icon="plus" busy={busy} onClick={() => void generate()}>
            {active || fresh ? "Generar link nuevo" : "Compartir catálogo mayorista"}
          </AdminButton>
          {active || fresh ? (
            <AdminButton variant="ghost" icon="close" disabled={busy} onClick={() => setConfirmRevoke(true)}>
              Revocar link
            </AdminButton>
          ) : null}
        </span>
      ) : null}
      {confirmRevoke ? (
        <AdminDialog
          title="Revocar el link mayorista"
          description={`${clientName} dejará de poder abrir su catálogo mayorista con ese link.`}
          onClose={() => setConfirmRevoke(false)}
          footer={
            <>
              <AdminButton onClick={() => setConfirmRevoke(false)}>Cancelar</AdminButton>
              <AdminButton variant="primary" busy={busy} onClick={() => void revoke()}>Revocar link</AdminButton>
            </>
          }
        >
          <p>Los pedidos que ya hizo siguen en el panel. Podés generar un link nuevo cuando quieras.</p>
        </AdminDialog>
      ) : null}
    </AdminPanel>
  );
}
