"use client";
import { useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { NumberField } from "../AdminFields";
import { AdminButton, AdminNote } from "../AdminUI";

/** Explicit count confirmation reuses inventory units and the normal inventory writer permission. */
export function InventoryCountPanel({ id, registered, writable, onChanged }: { id: string; registered: number; writable: boolean; onChanged: () => void }) {
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirmCount() {
    const quantity = Number(total);
    if (!total.trim() || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100_000) { setError("Ingresá un total entero de 0 a 100.000, incluyendo cero si no hay unidades."); return; }
    setBusy(true); setError("");
    const result = await adminSend("/api/admin/inventory", { kind: "item-confirm-count", id, quantity });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onChanged();
  }
  return <div className="admin-stack">
    <AdminNote tone="warn">Pendiente conteo. Hay {registered} unidades registradas; el total todavía es desconocido. No se promete disponibilidad hasta confirmar el total. Una compra o una unidad nueva no confirma el total. Confirmar un total es una declaración manual; no ejecuta ni acredita un conteo físico.</AdminNote>
    {writable ? <>
      <NumberField label="Total declarado" value={total} onChange={setTotal} strictInteger maxLength={6} size="sm" disabled={busy} error={error || undefined} hint="Confirmar agrega las unidades que falten. No elimina unidades ni modifica reservas, estados o precios." />
      <AdminButton onClick={() => void confirmCount()} disabled={busy || !total.trim()}>{busy ? "Confirmando…" : "Confirmar total"}</AdminButton>
    </> : null}
  </div>;
}
