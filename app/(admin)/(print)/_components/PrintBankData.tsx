"use client";

import type { AdminPaymentDetails } from "@/lib/admin-types";
import { bankMark } from "@/lib/bank-mark";

/**
 * Datos bancarios de la hoja impresa (issue #14): marca del banco (asset del
 * repo o monograma) más titular, RUC, cuenta y alias.
 *
 * Es una isla cliente porque la marca del banco sale de `owncoding-ui`
 * (`lib/bank-mark.ts`), un bundle `"use client"`: la página imprimible es un
 * componente de servidor y no puede llamar funciones de un módulo cliente.
 * En servidor renderiza igual (SSR), así que el HTML impreso no cambia.
 */
export function PrintBankData({ details }: { details: AdminPaymentDetails }) {
  const mark = bankMark(details.bank);
  return (
    <div className="lbprint-bank">
      {mark?.asset ? (
        <img className="lbprint-bank-asset" src={mark.asset} alt={`Logo de ${mark.label}`} />
      ) : (
        <span className="lbprint-bank-mark" style={{ background: mark?.color ?? "#0E5A8A" }} aria-hidden="true">
          {mark?.initials ?? "B"}
        </span>
      )}
      <div className="lbprint-bank-data">
        <span className="lbprint-bank-name">{mark?.label ?? details.bank ?? "Datos de pago"}</span>
        {details.holder ? <span className="lbprint-bank-line">Titular: {details.holder}</span> : null}
        {details.ruc ? <span className="lbprint-bank-line">RUC: {details.ruc}</span> : null}
        {details.account ? <span className="lbprint-bank-line">Cuenta: {details.account}</span> : null}
        {details.alias ? <span className="lbprint-bank-line">Alias: {details.alias}</span> : null}
      </div>
    </div>
  );
}
