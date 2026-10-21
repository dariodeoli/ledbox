"use client";

import { useEffect, useRef, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import type { AdminClientRucSnapshot } from "@/lib/admin-types";
import type { OwnDataResult } from "@/lib/server/ruc-owndata";
import { AdminButton, AdminNote } from "../AdminUI";
import { CheckboxField, RucField, TextField } from "../AdminFields";

type RucProposal = OwnDataResult & { lookedUpAt: string; confirmationToken: string };
type FiscalPatch = { ruc?: string; legalName?: string; legalRepresentative?: string; rucConfirmationToken?: string; rucSnapshot?: AdminClientRucSnapshot | null };

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

/** Flujo fiscal: Enter o botón consulta, completa identidad y deja editar antes de guardar. */
export function ClientFiscalFields({ ruc, legalName, snapshot, onChange }: {
  ruc: string;
  legalName: string;
  snapshot: AdminClientRucSnapshot | null;
  onChange: (patch: FiscalPatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<RucProposal | null>(null);
  const [individualConfirmed, setIndividualConfirmed] = useState(false);
  const [applied, setApplied] = useState(false);
  const inFlight = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentRuc = useRef(ruc);
  currentRuc.current = ruc;

  function manual(patch: FiscalPatch) {
    revision.current++;
    setProposal(null);
    setApplied(false);
    setError("");
    onChange({ ...patch, rucConfirmationToken: "", rucSnapshot: null });
  }

  async function lookup() {
    if (inFlight.current || !ruc.trim()) return;
    inFlight.current = true;
    const requested = ruc;
    const requestedRevision = revision.current;
    setBusy(true);
    setError("");
    setProposal(null);
    setApplied(false);
    const result = await adminSend<RucProposal>("/api/admin/clients/ruc", { numero: requested.trim(), confirmLookup: true, subjectKind: individualConfirmed ? "individual" : "unknown" });
    inFlight.current = false;
    if (!mounted.current) return;
    setBusy(false);
    // Una respuesta de otra edición del campo no puede proponer identidad fiscal.
    if (currentRuc.current !== requested || revision.current !== requestedRevision) return;
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

  function applyProposal() {
    if (!proposal) return;
    onChange({
      ruc: proposal.fullRuc,
      legalName: proposal.name,
      ...(proposal.namePresentationFull ? { legalRepresentative: proposal.namePresentationFull } : {}),
      rucConfirmationToken: proposal.confirmationToken,
      rucSnapshot: null,
    });
    setProposal(null);
    setApplied(true);
  }

  return <>
    <RucField label="RUC / CI" maxLength={30} value={ruc} onChange={(value) => manual({ ruc: value })}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void lookup();
        }
      }}
      hint="Ingresá el documento y presioná Enter para consultar. También podés completar los datos manualmente." />
    <CheckboxField checked={individualConfirmed} onChange={(checked) => { setIndividualConfirmed(checked); setProposal(null); setApplied(false); }} text="Confirmo que el titular es una persona (mostrar nombres antes de apellidos)" />
    <AdminButton type="button" icon="search" disabled={!ruc.trim() || busy} busy={busy} onClick={() => void lookup()}>Extraer datos del RUC</AdminButton>
    <AdminNote>La consulta a OwnData puede consumir tu cuota. Revisá o editá los datos antes de guardar.</AdminNote>
    <TextField label="Razón social oficial" maxLength={300} value={legalName} onChange={(value) => manual({ legalName: value })}
      hint="Entrada manual disponible. La consulta completa la identidad fiscal; no cambia fantasía ni contactos." />
    {error ? <AdminNote tone="error">{error}</AdminNote> : null}
    {proposal ? <><AdminNote>Resultado listo para revisar. No se aplicó todavía a este cliente.</AdminNote><AdminButton type="button" variant="primary" icon="check" onClick={applyProposal}>Aplicar datos fiscales</AdminButton></> : null}
    {applied ? <AdminNote>Datos fiscales aplicados; podés editarlos antes de guardar.</AdminNote> : null}
    {!proposal && !snapshot ? <AdminNote>Sin snapshot oficial confirmado. Los datos fiscales pueden cargarse manualmente.</AdminNote> : null}

  </>;
}
