"use client";

import { useRef, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { formatDateTime, formatNumber } from "@/lib/admin-format";
import type { AdminClientRucSnapshot } from "@/lib/admin-types";
import type { OwnDataResult } from "@/lib/server/ruc-owndata";
import { AdminButton, AdminDialog, AdminNote } from "../AdminUI";
import { RucField, TextField } from "../AdminFields";

type RucProposal = OwnDataResult & { lookedUpAt: string; confirmationToken: string };
type FiscalPatch = { ruc?: string; legalName?: string; rucConfirmationToken?: string; rucSnapshot?: AdminClientRucSnapshot | null };

export function ClientFiscalSnapshot({ snapshot }: { snapshot: AdminClientRucSnapshot | null }) {
  if (!snapshot) return <AdminNote>Sin snapshot oficial confirmado; identidad fiscal manual.</AdminNote>;
  return <dl className="admin-dialog-facts" aria-label="Snapshot fiscal confirmado">
    <div><dt>Fuente</dt><dd>Snapshot oficial DNIT · {snapshot.provenance.sourcePage}</dd></div>
    <div><dt>Publicación oficial</dt><dd>{snapshot.provenance.publicationDate}</dd></div>
    <div><dt>Consultado</dt><dd>{formatDateTime(snapshot.lookedUpAt)}</dd></div>
    <div><dt>Confirmado</dt><dd>{formatDateTime(snapshot.confirmedAt)}</dd></div>
    <div><dt>Ambiente</dt><dd>{snapshot.environment === "test" ? "Prueba" : "Real"}</dd></div>
  </dl>;
}

/** Flujo fiscal del cliente: consulta explícita → revisar → aplicar → guardar token. */
export function ClientFiscalFields({ ruc, legalName, snapshot, confirmed, onChange }: {
  ruc: string;
  legalName: string;
  snapshot: AdminClientRucSnapshot | null;
  confirmed: boolean;
  onChange: (patch: FiscalPatch) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<RucProposal | null>(null);
  const currentRuc = useRef(ruc);
  currentRuc.current = ruc;

  function manual(patch: FiscalPatch) {
    setProposal(null);
    setError("");
    onChange({ ...patch, rucConfirmationToken: "", rucSnapshot: null });
  }

  async function lookup() {
    if (busy) return;
    const requested = ruc;
    setBusy(true);
    setError("");
    setProposal(null);
    const result = await adminSend<RucProposal>("/api/admin/clients/ruc", { numero: requested.trim(), confirmLookup: true });
    setBusy(false);
    setConsent(false);
    // Una respuesta de otra edición del campo no puede proponer identidad fiscal.
    if (currentRuc.current !== requested) return;
    if (!result.ok) {
      setError(`${result.error} Podés completar RUC y razón social a mano.`);
      return;
    }
    if (!result.data.confirmationToken || !result.data.name || !result.data.fullRuc || !result.data.ownData?.provenance) {
      setError("La consulta no devolvió un resultado fiscal confirmable. Completá los datos a mano.");
      return;
    }
    setProposal(result.data);
  }

  const source = proposal?.ownData.provenance ?? snapshot?.provenance;
  return <>
    <RucField label="RUC / CI" maxLength={30} value={ruc} onChange={(value) => manual({ ruc: value })} />
    <AdminButton type="button" icon="search" disabled={!ruc.trim() || busy} busy={busy} onClick={() => setConsent(true)}>Consultar RUC en OwnData</AdminButton>
    <TextField label="Razón social oficial" maxLength={300} value={legalName} onChange={(value) => manual({ legalName: value })}
      hint="Entrada manual disponible. La consulta solo propone RUC y razón social; no cambia fantasía ni contactos." />
    {error ? <AdminNote tone="error">{error}</AdminNote> : null}
    {proposal ? <div className="admin-form-group admin-field--wide">
      <h3 className="admin-form-group-title">Revisar resultado fiscal</h3>
      <dl className="admin-dialog-facts">
        <div><dt>RUC propuesto</dt><dd>{proposal.fullRuc}</dd></div>
        <div><dt>Razón social propuesta</dt><dd>{proposal.name}</dd></div>
        <div><dt>Ambiente</dt><dd>{proposal.ownData.environment === "test" ? "Prueba" : "Real"}</dd></div>
        <div><dt>Cuota utilizada / límite</dt><dd>{formatNumber(proposal.ownData.quota.used)} / {formatNumber(proposal.ownData.quota.limit)}</dd></div>
        <div><dt>Cuota restante</dt><dd>{formatNumber(proposal.ownData.quota.remaining)}</dd></div>
        <div><dt>Costo monetario</dt><dd>No informado por el proveedor</dd></div>
      </dl>
      {confirmed ? <AdminNote>Resultado confirmado en este formulario; se aplica al guardar el cliente.</AdminNote> :
        <AdminButton type="button" icon="check" onClick={() => onChange({ ruc: proposal.fullRuc, legalName: proposal.name, rucConfirmationToken: proposal.confirmationToken, rucSnapshot: null })}>Confirmar RUC y razón social</AdminButton>}
    </div> : null}
    {source ? <dl className="admin-dialog-facts admin-field--wide" aria-label="Procedencia fiscal">
      <div><dt>Fuente</dt><dd>Snapshot oficial DNIT · {source.sourcePage}</dd></div>
      <div><dt>Publicación oficial</dt><dd>{source.publicationDate}</dd></div>
      <div><dt>Importado</dt><dd>{formatDateTime(source.importedAt)}</dd></div>
      <div><dt>Consultado</dt><dd>{formatDateTime(proposal?.lookedUpAt ?? snapshot?.lookedUpAt)}</dd></div>
      {snapshot?.confirmedAt ? <div><dt>Confirmado</dt><dd>{formatDateTime(snapshot.confirmedAt)}</dd></div> : null}
    </dl> : <AdminNote>Sin snapshot oficial confirmado. Los datos fiscales pueden cargarse manualmente.</AdminNote>}
    {consent ? <AdminDialog title="Confirmar consulta OwnData" onClose={() => { if (!busy) setConsent(false); }}>
      <p className="admin-dialog-text">Consultar el RUC {ruc} puede consumir cuota del proveedor. El costo monetario no está informado. El resultado se revisa antes de aplicarlo.</p>
      <div className="admin-dialog-foot">
        <AdminButton type="button" disabled={busy} onClick={() => setConsent(false)}>Cancelar</AdminButton>
        <AdminButton type="button" variant="primary" busy={busy} onClick={() => void lookup()}>Confirmar consulta</AdminButton>
      </div>
    </AdminDialog> : null}
  </>;
}
