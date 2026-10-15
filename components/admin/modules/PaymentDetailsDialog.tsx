"use client";
import { useEffect, useRef, useState } from "react";
import type { AdminPaymentDetails } from "@/lib/admin-types";
import { adminApiGet, adminSend } from "@/lib/admin-api";
import { bankMark, bankSuggestions } from "@/lib/bank-mark";
import { BankLogo } from "../BankLogo";
import { AdminButton, AdminDialog, AdminDialogSection, AdminNote } from "../AdminUI";
import { RucField, SegmentedField, TextField } from "../AdminFields";
const BANK_LIST_ID = "datos-pago-banco-opciones";

/**
 * Datos de pago de la empresa (issue #14): solo OWNER/ADMIN. Se cargan al abrir
 * el diálogo y se guardan en `app/api/admin/organization/payment-details`; el
 * portal los muestra recién con el presupuesto aprobado.
 */
export function PaymentDetailsDialog({ onClose }: { onClose: () => void }) {
  const [details, setDetails] = useState<AdminPaymentDetails>({ bank: "", holder: "", ruc: "", account: "", alias: "", accountType: "", currency: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Lo último cargado o guardado: «hay cambios sin guardar» es distinto de eso.
  const loadedRef = useRef(JSON.stringify({ bank: "", holder: "", ruc: "", account: "", alias: "", accountType: "", currency: "" }));

  useEffect(() => {
    let active = true;
    setLoading(true);
    void adminApiGet<{ paymentDetails?: Partial<AdminPaymentDetails> }>("/api/admin/organization/payment-details", {
      fresh: true,
      fallbackError: "No pudimos cargar los datos de pago.",
    })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          if (!result.sessionInvalid) setError(result.error);
          return;
        }
        const loaded = {
          bank: result.data.paymentDetails?.bank ?? "",
          holder: result.data.paymentDetails?.holder ?? "",
          ruc: result.data.paymentDetails?.ruc ?? "",
          account: result.data.paymentDetails?.account ?? "",
          alias: result.data.paymentDetails?.alias ?? "",
          accountType: result.data.paymentDetails?.accountType ?? "",
          currency: result.data.paymentDetails?.currency ?? "",
        };
        loadedRef.current = JSON.stringify(loaded);
        setDetails(loaded);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const mark = bankMark(details.bank);

  async function save() {
    setBusy(true);
    setError("");
    const result = await adminSend<{ paymentDetails?: AdminPaymentDetails }>("/api/admin/organization/payment-details", details);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    loadedRef.current = JSON.stringify(details);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <AdminDialog
      title="Datos de pago de la empresa"
      size="md"
      icon="building"
      description="Se muestran en el portal con el presupuesto aprobado y en la hoja imprimible. Sin datos, el portal no inventa una cuenta."
      error={error}
      dirty={!loading && JSON.stringify(details) !== loadedRef.current}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cerrar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="button" busy={busy} busyLabel="Guardando…" onClick={() => void save()} disabled={loading}>
            Guardar datos
          </AdminButton>
        </>
      )}
    >
      {loading ? (
        <p className="admin-dialog-text">Cargando datos de pago…</p>
      ) : (
        <AdminDialogSection title="Cuenta bancaria">
          <TextField
            label="Banco"
            hint="Del catálogo o libre; el monograma reemplaza al logo mientras no haya asset"
            list={BANK_LIST_ID}
            value={details.bank ?? ""}
            onChange={(value) => setDetails({ ...details, bank: value })}
            maxLength={80}
            placeholder="Ej.: Banco Continental"
          />
          <datalist id={BANK_LIST_ID}>
            {bankSuggestions(details.bank).map((banco) => (
              <option key={banco} value={banco} />
            ))}
          </datalist>
          <TextField
            label="Titular"
            value={details.holder ?? ""}
            onChange={(value) => setDetails({ ...details, holder: value })}
            maxLength={120}
            placeholder="LedBox S.A."
          />
          <RucField
            label="RUC"
            value={details.ruc ?? ""}
            onChange={(value) => setDetails({ ...details, ruc: value })}
          />
          <TextField
            label="Cuenta"
            value={details.account ?? ""}
            onChange={(value) => setDetails({ ...details, account: value })}
            maxLength={40}
            placeholder="1234567890"
          />
          <SegmentedField
            label="Tipo de cuenta"
            value={details.accountType ?? ""}
            onChange={(value) => setDetails({ ...details, accountType: value })}
            options={[{ value: "", label: "Sin indicar" }, { value: "CORRIENTE", label: "Corriente" }, { value: "AHORRO", label: "Caja de ahorro" }]}
          />
          <SegmentedField
            label="Moneda de la cuenta"
            value={details.currency ?? ""}
            onChange={(value) => setDetails({ ...details, currency: value })}
            options={[{ value: "", label: "Sin indicar" }, { value: "PYG", label: "PYG" }, { value: "USD", label: "USD" }, { value: "BRL", label: "BRL" }, { value: "EUR", label: "EUR" }]}
          />
          <TextField
            label="Alias"
            value={details.alias ?? ""}
            onChange={(value) => setDetails({ ...details, alias: value })}
            maxLength={60}
            placeholder="ledbox.cta"
          />
          {mark ? (
            <div className="admin-bank-preview">
              <BankLogo bank={details.bank} variant="horizontal" size="h-8" />
              <span>
                <strong>{mark.label}</strong>
              </span>
            </div>
          ) : null}
        </AdminDialogSection>
      )}
      {saved ? <AdminNote tone="ok">Datos de pago guardados.</AdminNote> : null}
    </AdminDialog>
  );
}

