"use client";

import { useEffect, useId, useState } from "react";
import { damageSummary, formatNumber, ITEM_CONDITIONS } from "@/lib/admin-format";
import type { AdminEventAssignment } from "@/lib/admin-types";
import { assignmentDispatched, assignmentPending } from "@/lib/event-readiness";
import { adminApiGet } from "@/lib/admin-api";
import { useOfflineQueue } from "../AdminOffline";
import { CheckboxField, DateTimeField, NumberField, SelectField, TextAreaField } from "../AdminFields";
import { AdminButton, AdminDialog, AdminDialogSection, AdminNote } from "../AdminUI";

/** Valor para `datetime-local` en hora local del navegador (es-PY, 24 h). */
function nowInput(): string {
  const date = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Unit = { id: string; code: string; status: string };

/**
 * Salida (despacho, admite parcial) y devolución (parcial, con dañadas y faltantes)
 * de una asignación de inventario. Mismo contrato que el panel online; sin conexión
 * `fieldAction` lo guarda en la cola local.
 */
export function InventoryMovementDialog({
  mode,
  assignment,
  eventName,
  onClose,
  onDone,
}: {
  mode: "checkout" | "checkin";
  assignment: AdminEventAssignment;
  eventName: string;
  onClose: () => void;
  onDone: (message: string, queued: boolean) => void;
}) {
  const { fieldAction } = useOfflineQueue();
  const formId = useId();
  const checkout = mode === "checkout";
  const remaining = assignment.quantity - assignmentDispatched(assignment);
  const pending = assignmentPending(assignment);
  const [at, setAt] = useState(nowInput);
  const [condition, setCondition] = useState<string>(ITEM_CONDITIONS[0]);
  const [quantity, setQuantity] = useState(String(checkout ? remaining : pending));
  const [damaged, setDamaged] = useState("0");
  const [missing, setMissing] = useState("0");
  const [notes, setNotes] = useState("");
  const [damagedIds, setDamagedIds] = useState<string[]>([]);
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsError, setUnitsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Unidades con código del ítem: si tiene, los daños y faltantes se eligen por código.
  useEffect(() => {
    if (checkout) return;
    let alive = true;
    void adminApiGet<{ units?: Unit[] }>(`/api/admin/inventory/incidents?units=${encodeURIComponent(assignment.inventory.id)}`, { fresh: true }).then((result) => {
      if (!alive) return;
      if (result.ok) setUnits(result.data.units ?? []);
      else setUnitsError(result.error);
    });
    return () => {
      alive = false;
    };
  }, [checkout, assignment.inventory.id]);

  const damagedCount = Number(damaged) || 0;
  const missingCount = Number(missing) || 0;
  const returnCount = Number(quantity) || 0;
  const hasUnits = units.length > 0;

  function toggle(list: string[], setList: (next: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);
  }

  function validate(): string {
    const limit = checkout ? remaining : pending;
    if (checkout) {
      if (returnCount < 1 || returnCount > limit) return `Indicá entre 1 y ${formatNumber(limit)} unidades a despachar.`;
      return "";
    }
    if (returnCount + missingCount < 1) return "Indicá cuántas unidades vuelven o cuántas faltan.";
    if (returnCount + missingCount > pending) return `Solo quedan ${formatNumber(pending)} unidades por devolver.`;
    if (damagedCount > returnCount) return "Las unidades dañadas tienen que estar entre las que vuelven.";
    if (hasUnits) {
      if (damagedIds.length !== damagedCount) return `Elegí las ${formatNumber(damagedCount)} unidades dañadas por su código.`;
      if (missingIds.length !== missingCount) return `Elegí las ${formatNumber(missingCount)} unidades faltantes por su código.`;
      if (damagedIds.some((id) => missingIds.includes(id))) return "Una unidad no puede estar dañada y faltante a la vez.";
    }
    return "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    const damages = damageSummary(damagedCount, missingCount);
    const result = await fieldAction({
      kind: checkout ? "inventory-checkout" : "inventory-checkin",
      path: "/api/admin/inventory",
      body: checkout
        ? { kind: "checkout", id: assignment.id, at: at || undefined, conditionOut: condition, quantity: returnCount, note: notes || undefined }
        : {
            kind: "checkin",
            id: assignment.id,
            at: at || undefined,
            conditionIn: condition,
            quantity: returnCount,
            damagedQuantity: damagedCount,
            missingQuantity: missingCount,
            damagedUnitIds: hasUnits ? damagedIds : undefined,
            missingUnitIds: hasUnits ? missingIds : undefined,
            damageNotes: notes || undefined,
          },
      summary: `${checkout ? "Salida" : "Devolución"} de «${assignment.inventory.name}» (${formatNumber(checkout ? returnCount : returnCount + missingCount)} u.)${!checkout && damages ? ` · ${damages}` : ""}`,
      detail: `Evento: ${eventName}`,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const label = checkout ? "Salida" : "Devolución";
    onDone(
      result.queued
        ? `Sin conexión: la ${label.toLowerCase()} quedó guardada en este equipo y se sube al volver la señal.`
        : `${label} registrada: ${assignment.inventory.name} (${formatNumber(returnCount)} u.). El remito quedó en Equipos: firmalo ahí.`,
      Boolean(result.queued),
    );
  }

  return (
    <AdminDialog
      title={`${checkout ? "Despachar" : "Registrar devolución"} · ${assignment.inventory.name}`}
      icon={checkout ? "arrow-right" : "checkin"}
      description={
        checkout
          ? `${formatNumber(assignment.quantity)} asignadas · ${formatNumber(remaining)} por despachar`
          : `${formatNumber(assignmentDispatched(assignment))} salieron · ${formatNumber(pending)} por devolver`
      }
      size="md"
      dirty={notes !== "" || damagedCount > 0 || missingCount > 0}
      error={error || null}
      warning={unitsError ? `No pudimos cargar las unidades con código: ${unitsError}` : null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" onClick={requestClose}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Guardando…">
            {checkout ? "Despachar" : "Registrar devolución"}
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <AdminDialogSection title={checkout ? "Salida" : "Devolución"}>
          <DateTimeField label={checkout ? "Fecha y hora de salida" : "Fecha y hora de devolución"} required value={at} onChange={setAt} />
          <SelectField
            label={checkout ? "Estado al retirar" : "Estado al devolver"}
            value={condition}
            onChange={setCondition}
            options={ITEM_CONDITIONS.map((item) => ({ value: item, label: item }))}
          />
          <NumberField strictInteger
            label={checkout ? "Unidades a despachar" : "Unidades que vuelven"}
            hint={checkout ? `Hasta ${formatNumber(remaining)}. Podés despachar en partes.` : `Hasta ${formatNumber(pending)}. Las que falten quedan pendientes.`}
            maxLength={6}
            required
            value={quantity}
            onChange={setQuantity}
          />
        </AdminDialogSection>

        {checkout ? null : (
          <AdminDialogSection title="Daños y faltantes" collapsible defaultOpen={damagedCount > 0 || missingCount > 0} hint="abren un incidente">
            <NumberField strictInteger label="De esas, dañadas" hint="Abre un incidente de daño." maxLength={6} value={damaged} onChange={setDamaged} />
            <NumberField strictInteger label="Faltantes (no vuelven)" hint="Abre un incidente de faltante." maxLength={6} value={missing} onChange={setMissing} />
          </AdminDialogSection>
        )}

        <AdminDialogSection title="Más opciones" collapsible defaultOpen={notes !== ""} hint="notas">
          <TextAreaField
            label={checkout ? "Nota de la salida" : "Notas"}
            hint={checkout ? "Quién retira, observaciones (opcional)" : "Detalle de daños o faltantes (opcional)"}
            wide
            rows={2}
            maxLength={400}
            value={notes}
            onChange={setNotes}
          />
        </AdminDialogSection>

        {!checkout && hasUnits && (damagedCount > 0 || missingCount > 0) ? (
          <AdminDialogSection title="Unidades afectadas">
            {damagedCount > 0 ? (
              <fieldset className="admin-field admin-field--wide">
                <legend className="admin-field-label">Dañadas ({damagedIds.length} de {damagedCount})</legend>
                {units.map((unit) => (
                  <CheckboxField
                    key={`d-${unit.id}`}
                    text={unit.code}
                    checked={damagedIds.includes(unit.id)}
                    onChange={() => toggle(damagedIds, setDamagedIds, unit.id)}
                  />
                ))}
              </fieldset>
            ) : null}
            {missingCount > 0 ? (
              <fieldset className="admin-field admin-field--wide">
                <legend className="admin-field-label">Faltantes ({missingIds.length} de {missingCount})</legend>
                {units.map((unit) => (
                  <CheckboxField
                    key={`m-${unit.id}`}
                    text={unit.code}
                    checked={missingIds.includes(unit.id)}
                    onChange={() => toggle(missingIds, setMissingIds, unit.id)}
                  />
                ))}
              </fieldset>
            ) : null}
          </AdminDialogSection>
        ) : null}

        {!checkout && (damagedCount > 0 || missingCount > 0) ? (
          <AdminNote>
            Las unidades dañadas o faltantes no vuelven a lo libre hasta resolver su incidente (reparado o dado de baja).
          </AdminNote>
        ) : null}
      </form>
    </AdminDialog>
  );
}
