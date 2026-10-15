"use client";

import { useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import {
  ACCESS_REQUEST_KIND_LABEL,
  ACCESS_REQUEST_STATUS_LABEL,
  CATALOG_ACCESS_MODES,
  CATALOG_ACCESS_MODE_HINT,
  CATALOG_ACCESS_MODE_LABEL,
  type AccessRequestStatus,
  type CatalogAccessMode,
} from "@/lib/catalog-access-mode";
import { useAdminSession } from "../AdminShell";
import { SegmentedField, TextAreaField, TextField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminDialog, AdminEmpty, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Acceso al catálogo (lo elige cada empresa): Abierto (cualquiera entra y pide), Con solicitud
 * (el cliente pide acceso y la empresa lo aprueba o rechaza acá) o Privado (solo con el link que da
 * la empresa). Al aprobar se genera su link, se le manda por correo y se muestra una sola vez acá.
 */

type RequestRow = {
  id: string;
  name: string;
  company: string | null;
  phone: string;
  email: string;
  kind: "RETAIL" | "WHOLESALE";
  status: AccessRequestStatus;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
};

type ApproveResult = { url: string; clientCreated: boolean; mail: { status: "sent" | "failed" | "skipped"; error?: string } };

const TONE: Record<AccessRequestStatus, "warn" | "ok" | "danger"> = { PENDING: "warn", APPROVED: "ok", REJECTED: "danger" };

export function CatalogAccessModeField({ value, onChange, disabled }: { value: CatalogAccessMode; onChange: (mode: CatalogAccessMode) => void; disabled?: boolean }) {
  return (
    <SegmentedField
      label="Quién entra al catálogo"
      value={value}
      onChange={(next) => onChange(next as CatalogAccessMode)}
      options={CATALOG_ACCESS_MODES.map((mode) => ({ value: mode, label: CATALOG_ACCESS_MODE_LABEL[mode] }))}
      hint={CATALOG_ACCESS_MODE_HINT[value]}
      wide
      disabled={disabled}
    />
  );
}

export function CatalogAccessRequests({ canDecide }: { canDecide: boolean }) {
  const { demo } = useAdminSession();
  const resource = useAdminResource("/api/admin/catalog-access-requests", (payload) => ((payload as { requests?: RequestRow[] }).requests ?? []) as RequestRow[]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fresh, setFresh] = useState<{ name: string; url: string; mail: ApproveResult["mail"] } | null>(null);
  const [rejecting, setRejecting] = useState<RequestRow | null>(null);
  const [reason, setReason] = useState("");

  const rows = resource.data ?? [];
  const pending = rows.filter((row) => row.status === "PENDING");

  async function approve(row: RequestRow) {
    setBusy(row.id);
    setError("");
    setNotice("");
    const result = await adminSend<ApproveResult>(`/api/admin/catalog-access-requests/${encodeURIComponent(row.id)}`, { action: "approve" }, "POST");
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      resource.reload();
      return;
    }
    setFresh({ name: row.name, url: result.data.url, mail: result.data.mail });
    setNotice(`Aprobaste a ${row.name}.${result.data.clientCreated ? " Creamos su ficha de cliente." : " Ya era cliente: usamos su ficha."}`);
    resource.reload();
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    setError("");
    const result = await adminSend(`/api/admin/catalog-access-requests/${encodeURIComponent(rejecting.id)}`, { action: "reject", reason: reason.trim() || undefined }, "POST");
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Rechazaste la solicitud de ${rejecting.name}.`);
    setRejecting(null);
    setReason("");
    resource.reload();
  }

  return (
    <AdminPanel title="Solicitudes de acceso" icon="users" meta={pending.length > 0 ? `${pending.length} pendiente${pending.length === 1 ? "" : "s"}` : "Sin pendientes"}>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {fresh ? (
        <div data-testid="access-fresh-link">
          <AdminNote tone="warn">
            {fresh.mail.status === "sent" ? "Le mandamos el link por correo. " : fresh.mail.status === "skipped" ? "No salió el correo (sin proveedor o sin destinatario). " : "No pudimos enviar el correo. "}
            Este es el link de {fresh.name}; por seguridad no se vuelve a mostrar:
          </AdminNote>
          <TextField label={`Link de ${fresh.name}`} value={fresh.url} onChange={() => undefined} readOnly />
          <AdminButton type="button" icon="copy" onClick={() => void navigator.clipboard?.writeText(fresh.url)}>Copiar link</AdminButton>
        </div>
      ) : null}
      {resource.loading ? <p className="admin-muted" role="status">Cargando solicitudes…</p> : null}
      {!resource.loading && rows.length === 0 ? <AdminEmpty icon="users" title="Todavía no hay solicitudes" hint="Cuando la tienda esté «Con solicitud», acá llegan los pedidos de acceso." /> : null}
      <ul className="admin-detail-list" data-testid="access-requests">
        {rows.map((row) => (
          <li key={row.id}>
            <p>
              <strong>{row.name}</strong>
              {row.company ? ` · ${row.company}` : ""} <AdminBadge tone="accent">{ACCESS_REQUEST_KIND_LABEL[row.kind]}</AdminBadge> <AdminBadge tone={TONE[row.status] ?? "neutral"}>{ACCESS_REQUEST_STATUS_LABEL[row.status] ?? row.status}</AdminBadge>
            </p>
            <p className="admin-cell-sub">{row.phone} · {row.email} · pidió el {formatDateTime(row.createdAt)}</p>
            {row.status === "REJECTED" && row.rejectionReason ? <p className="admin-cell-sub">Motivo: {row.rejectionReason}</p> : null}
            {row.status !== "PENDING" && row.decidedAt ? <p className="admin-cell-sub">Respondida el {formatDateTime(row.decidedAt)}{row.decidedByName ? ` por ${row.decidedByName}` : ""}.</p> : null}
            {row.status === "PENDING" && canDecide ? (
              <div className="admin-detail-actions">
                <AdminButton type="button" variant="primary" icon="check" busy={busy === row.id} busyLabel="Aprobando…" disabled={demo || Boolean(busy)} onClick={() => void approve(row)}>Aprobar y enviar link</AdminButton>
                <AdminButton type="button" disabled={demo || Boolean(busy)} onClick={() => { setRejecting(row); setReason(""); }}>Rechazar</AdminButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {rejecting ? (
        <AdminDialog
          title={`Rechazar a ${rejecting.name}`}
          icon="alert"
          size="sm"
          description="No se le avisa por correo. El motivo queda solo para tu equipo."
          dirty={reason.trim().length > 0}
          onClose={() => setRejecting(null)}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose}>Cancelar</AdminButton>
              <AdminButton type="button" variant="danger" icon="check" busy={busy === rejecting.id} busyLabel="Rechazando…" onClick={() => void reject()}>Rechazar solicitud</AdminButton>
            </>
          )}
        >
          <TextAreaField label="Motivo (opcional)" value={reason} onChange={setReason} maxLength={300} rows={3} counter />
        </AdminDialog>
      ) : null}
    </AdminPanel>
  );
}
