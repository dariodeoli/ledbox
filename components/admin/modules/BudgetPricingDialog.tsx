"use client";

import { useMemo, useState } from "react";
import {
  AdminButton,
  AdminDialog,
  AdminNote,
} from "@/components/admin/AdminUI";
import {
  AttachmentInput,
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/AdminFields";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { adminApiUpload, adminSend } from "@/lib/admin-api";
import { budgetReference, formatMoney, formatNumber, invoiceTaxTypeLabel } from "@/lib/admin-format";
import {
  BUDGET_ATTACHMENT_MAX_BYTES,
  type AdminBudgetAttachmentRow,
  type AdminBudgetRow,
} from "@/lib/admin-types";
import { discountForPrice, distributePrice, internalCostOf, marginOf, priceForMargin } from "@/lib/budget-costs";

/**
 * Precio, condiciones y adjunto de un presupuesto (issue #65): el lugar donde el
 * dueño define el **precio final** con su margen a la vista, separa los costos
 * internos (materiales y mano de obra, además del costo por ítem) y completa los
 * datos que ve el cliente (vigencia, entrega, IVA, garantía, observaciones).
 *
 * Los costos y el margen son internos: no se publican en el portal, el
 * imprimible ni el link enviado (lo fija `tests/budget-privacy.test.ts`). Lo
 * aprobado por el cliente no se reescribe: sin aprobación, el precio y los datos
 * del cliente se editan; los costos internos se pueden corregir siempre.
 */

type ItemDraft = {
  id: string | null;
  name: string;
  quantity: string;
  days: string;
  unitPrice: string;
  costPrice: string;
};

type Draft = {
  items: ItemDraft[];
  materialCost: string;
  laborCost: string;
  price: string;
  marginPercent: string;
  validUntil: string;
  deliveryAt: string;
  ivaType: string;
  warranty: string;
  notes: string;
};

const IVA_OPTIONS = [
  { value: "", label: "Sin definir" },
  { value: "IVA10", label: invoiceTaxTypeLabel("IVA10") },
  { value: "IVA5", label: invoiceTaxTypeLabel("IVA5") },
  { value: "EXEMPT", label: invoiceTaxTypeLabel("EXEMPT") },
];

function toItemDraft(item: AdminBudgetRow["items"][number]): ItemDraft {
  return {
    id: item.id,
    name: item.name,
    quantity: String(item.quantity),
    days: String(item.days),
    unitPrice: String(item.unitPrice),
    costPrice: String(item.costPrice),
  };
}

function draftFrom(budget: AdminBudgetRow): Draft {
  return {
    items: budget.items.map(toItemDraft),
    materialCost: String(budget.materialCost ?? 0),
    laborCost: String(budget.laborCost ?? 0),
    price: String(budget.total),
    marginPercent: "",
    validUntil: budget.validUntil ? budget.validUntil.slice(0, 10) : "",
    deliveryAt: budget.deliveryAt ? budget.deliveryAt.slice(0, 10) : "",
    ivaType: budget.ivaType ?? "",
    warranty: budget.warranty ?? "",
    notes: budget.notes ?? "",
  };
}

function number(value: string): number {
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function BudgetPricingDialog({
  budget,
  onClose,
  onSaved,
}: {
  budget: AdminBudgetRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(budget));
  const [attachments, setAttachments] = useState<AdminBudgetAttachmentRow[]>(budget.attachments ?? []);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approved = Boolean(budget.approvedAt);
  const closed = budget.status === "LOST" || budget.status === "CANCELLED";

  const priced = useMemo(
    () =>
      draft.items.map((item) => {
        const quantity = Math.max(1, number(item.quantity));
        const days = Math.max(1, number(item.days));
        const unitPrice = number(item.unitPrice);
        const costPrice = number(item.costPrice);
        return { id: item.id, name: item.name, quantity, days, unitPrice, costPrice, subtotal: quantity * days * unitPrice };
      }),
    [draft.items],
  );
  const itemsSubtotal = priced.reduce((sum, item) => sum + item.subtotal, 0);
  const cost = internalCostOf({
    materialCost: number(draft.materialCost),
    laborCost: number(draft.laborCost),
    items: priced.map((item) => ({ quantity: item.quantity, days: item.days, costPrice: item.costPrice })),
  });
  const price = number(draft.price);
  const margin = marginOf(price, cost.total);
  const intent = discountForPrice(itemsSubtotal, price);
  const needsRepricing = !intent.ok && price > 0;
  const repriced = needsRepricing ? distributePrice(priced, price) : null;
  const marginPercentValue = draft.marginPercent ? Number(draft.marginPercent.replace(",", ".")) : null;
  const suggested = marginPercentValue !== null && Number.isFinite(marginPercentValue) ? priceForMargin(cost.total, marginPercentValue) : null;

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    }));
  }

  /** Ajusta los precios unitarios para llegar al precio final escrito (misma suma). */
  function applySuggestedMargin() {
    if (suggested === null) {
      setError("El margen tiene que estar entre 0 y 99,99 % y el costo interno tiene que ser mayor a cero.");
      return;
    }
    setError("");
    setDraft((current) => ({ ...current, price: String(suggested) }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (priced.length === 0) {
      setError("El presupuesto necesita al menos un ítem con nombre.");
      return;
    }
    setBusy(true);
    try {
      // 1) Ítems: se guardan si cambió algo (o si el precio final obliga a
      //    repartirlo entre los precios unitarios).
      const itemsPayload = priced.map((item, index) => ({
        id: item.id ?? undefined,
        name: item.name,
        quantity: item.quantity,
        days: item.days,
        unitPrice: needsRepricing ? repriced?.items[index]?.unitPrice ?? item.unitPrice : item.unitPrice,
        costPrice: item.costPrice,
      }));
      const itemsChanged =
        needsRepricing ||
        priced.length !== budget.items.length ||
        priced.some((item, index) => {
          const original = budget.items[index];
          return (
            !item.id ||
            !original ||
            item.name !== original.name ||
            item.quantity !== original.quantity ||
            item.days !== original.days ||
            item.unitPrice !== original.unitPrice ||
            item.costPrice !== original.costPrice
          );
        });
      if (itemsChanged) {
        if (approved || closed) {
          setError("El presupuesto ya está aprobado o cerrado: sus ítems no se pueden cambiar.");
          return;
        }
        const itemsResult = await adminSend(`/api/admin/budgets`, { kind: "items", budgetId: budget.id, items: itemsPayload }, "PATCH");
        if (!itemsResult.ok) {
          setError(itemsResult.error);
          return;
        }
      }

      // 2) Precio final y condiciones: el precio se aplica como descuento cuando
      //    entra en los ítems; si hubo reparto de precios, no hay descuento.
      const discount = needsRepricing ? 0 : intent.ok ? intent.discount : 0;
      const result = await adminSend(
        "/api/admin/budgets",
        {
          kind: "commercial",
          budgetId: budget.id,
          discount,
          materialCost: number(draft.materialCost),
          laborCost: number(draft.laborCost),
          validUntil: draft.validUntil || null,
          deliveryAt: draft.deliveryAt || null,
          ivaType: draft.ivaType || null,
          warranty: draft.warranty,
          notes: draft.notes,
        },
        "PATCH",
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(needsRepricing ? "Precio final y precios de los ítems guardados." : "Precio, costos y condiciones guardados.");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment() {
    if (!attachmentFile) return;
    setAttachmentBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("budgetId", budget.id);
      form.append("file", attachmentFile);
      const result = await adminApiUpload<{ attachment?: AdminBudgetAttachmentRow }>("/api/admin/budgets/attachments", form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const created = result.data?.attachment;
      if (created) setAttachments((current) => [created, ...current]);
      setAttachmentFile(null);
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function removeAttachment(attachment: AdminBudgetAttachmentRow) {
    setAttachmentBusy(true);
    setError("");
    try {
      const result = await adminSend(`/api/admin/budgets/attachments/${attachment.id}`, {}, "DELETE");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAttachments((current) => current.filter((row) => row.id !== attachment.id));
    } finally {
      setAttachmentBusy(false);
    }
  }

  return (
    <AdminDialog title={`Precio y condiciones · ${budget.title}`} size="wide" icon="finance" onClose={onClose}>
      <p className="admin-dialog-text">
        Presupuesto Nº {budgetReference(budget.id)} de {budget.client.company?.trim() || budget.client.name}. El cliente ve el
        precio final y estas condiciones; los costos internos y el margen quedan solo en el panel.
      </p>
      {approved ? (
        <AdminNote tone="ok">
          El presupuesto ya está aprobado por el cliente: los ítems, el precio y las condiciones quedan como se enviaron. Los
          costos internos sí se pueden corregir.
        </AdminNote>
      ) : null}
      {closed ? <AdminNote tone="warn">Este presupuesto está {budget.status === "LOST" ? "perdido" : "cancelado"}: no se edita.</AdminNote> : null}

      <form onSubmit={(event) => void save(event)}>
        <p className="admin-dialog-text">Ítems y precios (cantidades, días, precio y costo unitario).</p>
        <div className="admin-plan-list">
          {draft.items.map((item, index) => (
            <div className="admin-plan-grid" key={item.id ?? `nuevo-${index}`}>
              <TextField
                label={`Ítem ${index + 1}`}
                value={item.name}
                maxLength={160}
                disabled={approved || closed}
                onChange={(value) => updateItem(index, { name: value })}
              />
              <NumberField
                label="Cantidad"
                value={item.quantity}
                maxLength={4}
                disabled={approved || closed}
                onChange={(value) => updateItem(index, { quantity: value })}
              />
              <NumberField
                label="Días"
                value={item.days}
                maxLength={3}
                disabled={approved || closed}
                onChange={(value) => updateItem(index, { days: value })}
              />
              <MoneyField
                label="Precio unitario (Gs)"
                value={item.unitPrice}
                disabled={approved || closed}
                onChange={(value) => updateItem(index, { unitPrice: value })}
              />
              <MoneyField
                label="Costo unitario (Gs)"
                hint="Interno"
                value={item.costPrice}
                disabled={approved || closed}
                onChange={(value) => updateItem(index, { costPrice: value })}
              />
              {!approved && !closed && draft.items.length > 1 ? (
                <AdminButton
                  icon="close"
                  title={`Quitar el ítem ${index + 1}`}
                  aria-label={`Quitar el ítem ${index + 1}`}
                  onClick={() => setDraft({ ...draft, items: draft.items.filter((_, position) => position !== index) })}
                />
              ) : null}
            </div>
          ))}
          {!approved && !closed ? (
            <AdminButton
              icon="plus"
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  items: [...draft.items, { id: null, name: "", quantity: "1", days: "1", unitPrice: "0", costPrice: "0" }],
                })
              }
            >
              Agregar ítem
            </AdminButton>
          ) : null}
        </div>

        <p className="admin-dialog-text">Costos internos y precio final (no los ve el cliente).</p>
        <div className="admin-plan-grid">
          <MoneyField
            label="Materiales (Gs)"
            hint="Costo interno"
            value={draft.materialCost}
            onChange={(value) => setDraft({ ...draft, materialCost: value })}
          />
          <MoneyField
            label="Mano de obra (Gs)"
            hint="Costo interno"
            value={draft.laborCost}
            onChange={(value) => setDraft({ ...draft, laborCost: value })}
          />
          <MoneyField
            label="Precio final (Gs)"
            hint="Lo que paga el cliente"
            value={draft.price}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, price: value })}
          />
          <PercentField
            label="Margen deseado (%)"
            hint="Sobre el precio final"
            value={draft.marginPercent}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, marginPercent: value })}
          />
          <AdminButton icon="finance" type="button" disabled={approved || closed} onClick={applySuggestedMargin}>
            {suggested !== null ? `Usar ${formatMoney(suggested)}` : "Calcular precio"}
          </AdminButton>
        </div>

        <AdminNote tone={margin && margin.amount < 0 ? "warn" : undefined}>
          Costo interno {formatMoney(cost.total)} (ítems {formatMoney(cost.items)} · materiales {formatMoney(cost.materials)} ·
          mano de obra {formatMoney(cost.labor)}). Precio final {formatMoney(price)} ·{" "}
          {margin ? `margen ${formatNumber(margin.percent)} % (${formatMoney(margin.amount)})` : "sin margen calculable: cargá el costo interno y el precio final"}.
          {needsRepricing && repriced ? " Al guardar, el precio se reparte entre los precios unitarios de los ítems." : ""}
        </AdminNote>

        <div className="admin-plan-grid">
          <DateField
            label="Vigencia de la oferta"
            value={draft.validUntil}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, validUntil: value })}
          />
          <DateField
            label="Fecha de entrega"
            value={draft.deliveryAt}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, deliveryAt: value })}
          />
          <SelectField
            label="IVA"
            value={draft.ivaType}
            options={IVA_OPTIONS}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, ivaType: value })}
          />
          <TextAreaField
            label="Garantía"
            wide
            value={draft.warranty}
            maxLength={400}
            rows={2}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, warranty: value })}
            placeholder="Ej.: 12 meses por defectos de fabricación"
          />
          <TextAreaField
            label="Observaciones"
            wide
            value={draft.notes}
            maxLength={2000}
            rows={3}
            disabled={approved || closed}
            onChange={(value) => setDraft({ ...draft, notes: value })}
          />
        </div>

        {error ? <AdminNote tone="error">{error}</AdminNote> : null}
        <div className="admin-dialog-foot">
          <AdminButton type="button" onClick={onClose}>
            Cancelar
          </AdminButton>
          <span className="admin-dialog-spacer" />
          <AdminButton type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Guardando…" : needsRepricing ? "Ajustar precios y guardar" : "Guardar"}
          </AdminButton>
        </div>
      </form>

      <div className="admin-plan-list">
        <AttachmentInput
          label="Adjunto del presupuesto"
          hint={`El PDF original u otro archivo (hasta ${Math.round(BUDGET_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB). Es interno: no se publica.`}
          wide
          disabled={attachmentBusy}
          onSelect={setAttachmentFile}
        />
        <AdminButton icon="upload" type="button" disabled={!attachmentFile || attachmentBusy} onClick={() => void uploadAttachment()} aria-busy={attachmentBusy || undefined}>
          {attachmentBusy ? "Subiendo…" : attachmentFile ? `Subir «${attachmentFile.name}»` : "Subir adjunto"}
        </AdminButton>
        {attachments.length > 0 ? (
          <ul className="admin-plan-list">
            {attachments.map((attachment) => (
              <li className="admin-plan-row" key={attachment.id}>
                <a
                  className="admin-btn admin-btn--ghost"
                  href={`/api/admin/budgets/attachments/${attachment.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Abrir «${attachment.name}»`}
                >
                  <AdminIcon name="receipt" size={14} />
                  <span>{attachment.name}</span>
                </a>
                <small className="admin-cell-sub">
                  {formatNumber(Math.max(1, Math.round(attachment.size / 1024)))} kB · {attachment.uploadedByName}
                </small>
                <AdminButton
                  icon="trash"
                  title={`Borrar «${attachment.name}»`}
                  aria-label={`Borrar «${attachment.name}»`}
                  disabled={attachmentBusy}
                  onClick={() => void removeAttachment(attachment)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-dialog-text">Sin adjuntos: subí el PDF original del cliente para tenerlo a mano.</p>
        )}
      </div>
    </AdminDialog>
  );
}
