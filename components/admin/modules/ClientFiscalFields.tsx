"use client";

import { useEffect, useRef, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import type { AdminClientRucSnapshot } from "@/lib/admin-types";
import type { OwnDataResult } from "@/lib/server/ruc-owndata";
import { AdminButton, AdminNote } from "../AdminUI";
import { RucField, TextField } from "../AdminFields";

type RucProposal = OwnDataResult & { lookedUpAt: string; confirmationToken: string };
type FiscalPatch = { ruc?: string; legalName?: string; legalRepresentative?: string; rucConfirmationToken?: string; rucSnapshot?: AdminClientRucSnapshot | null };

/** OwnData devuelve personas como «APELLIDO, NOMBRES». La ficha los muestra
 * en el orden de lectura habitual, sin tocar la razón social oficial firmada. */
function representativeName(value: string) {
  const [surname, given, ...rest] = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (!surname || !given || rest.length > 0 || /\bS\.?\s*A\.?\b|\bS\.?\s*R\.?\s*L\.?\b|\bEAS\b/i.test(given)) return "";
  if (!/^[\p{L} .'-]+$/u.test(surname) || !/^[\p{L} .'-]+$/u.test(given)) return "";
  return `${given} ${surname}`.replace(/\s+/g, " ").trim();
}

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
  const inFlight = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentRuc = useRef(ruc);
  currentRuc.current = ruc;

  function manual(patch: FiscalPatch) {
    revision.current++;
    setProposal(null);
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
    const result = await adminSend<RucProposal>("/api/admin/clients/ruc", { numero: requested.trim(), confirmLookup: true });
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
    // La razón social conserva el valor oficial firmado. Si el proveedor devuelve
    // una persona en formato «APELLIDO, NOMBRES», prellenamos el representante
    // en el orden habitual; empresa, fantasía y contactos no se tocan.
    const legalRepresentative = representativeName(result.data.name);
    onChange({ ruc: result.data.fullRuc, legalName: result.data.name, ...(legalRepresentative ? { legalRepresentative } : {}), rucConfirmationToken: result.data.confirmationToken, rucSnapshot: null });
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
    <AdminButton type="button" icon="search" disabled={!ruc.trim() || busy} busy={busy} onClick={() => void lookup()}>Extraer datos del RUC</AdminButton>
    <AdminNote>La consulta a OwnData puede consumir tu cuota. Revisá o editá los datos antes de guardar.</AdminNote>
    <TextField label="Razón social oficial" maxLength={300} value={legalName} onChange={(value) => manual({ legalName: value })}
      hint="Entrada manual disponible. La consulta completa la identidad fiscal; no cambia fantasía ni contactos." />
    {error ? <AdminNote tone="error">{error}</AdminNote> : null}
    {proposal ? <AdminNote>Datos fiscales cargados automáticamente; podés editarlos antes de guardar.</AdminNote> : null}
    {!proposal && !snapshot ? <AdminNote>Sin snapshot oficial confirmado. Los datos fiscales pueden cargarse manualmente.</AdminNote> : null}

  </>;
}
