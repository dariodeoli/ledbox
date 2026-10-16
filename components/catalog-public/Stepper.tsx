"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { NumberField } from "@/components/admin/AdminFields";
import { quantityFromDraft, stepQuantity } from "@/lib/quantity-control";
import { XIcon } from "./StoreIcons";

/** One quantity/day control. Store tiles use an output; editable cart/portal
 * variants share NumberField and the same whole-number/range rules. */
export function Stepper({ label, value, step = 1, min = 0, max = 99, onChange, onStep, editable = false, variant = "store", disabled = false, readOnly = false }: {
  label: string; value: number; step?: number; min?: number; max?: number;
  onChange: (next: number) => void;
  /** Functional parent updates can apply the delta to their freshest draft. */
  onStep?: (delta: number) => void;
  editable?: boolean; variant?: "store" | "portal" | "cart";
  disabled?: boolean; readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const locked = disabled || readOnly;
  const change = (text: string) => {
    if (locked) return;
    const next = quantityFromDraft(text, min, max);
    if (next === null && text !== "") return;
    setDraft(next === null ? text : String(next));
    if (next !== null) onChange(next);
  };
  const move = (delta: number) => {
    if (locked) return;
    const next = stepQuantity(value, delta, min, max);
    setDraft(String(next));
    if (onStep) onStep(delta); else onChange(next);
  };
  const className = variant === "store" ? "cp-stepper" : variant === "portal" ? "portal-stepper" : "cart-stepper";
  return (
    <div className={`${className} quantity-stepper${editable ? " quantity-stepper--editable" : ""}`} style={editable ? { "--quantity-input-width": `${Math.max(3, String(max).length, String(value).length) + 2}ch` } as CSSProperties : undefined} role="group" aria-label={variant === "store" ? `Cantidad de ${label}` : label}>
      <button type="button" className={variant === "portal" ? "portal-step" : undefined} disabled={locked || value <= min} onClick={() => move(-step)} aria-label={`Restar ${step} a ${label}`}><XIcon name="minus" size={16} /></button>
      {editable ? (
        <NumberField
          ariaLabel={`${label} (${min} a ${max})`}
          value={draft}
          onChange={change}
          onBlur={() => setDraft(String(value))}
          onKeyDown={(event) => {
            if (!locked && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              move(event.key === "ArrowUp" ? step : -step);
            }
          }}
          strictInteger
          disabled={disabled}
          readOnly={readOnly}
        />
      ) : <output aria-live="polite">{value}</output>}
      <button type="button" className={variant === "portal" ? "portal-step" : undefined} disabled={locked || value >= max} onClick={() => move(step)} aria-label={`Sumar ${step} a ${label}`}><XIcon name="plus" size={16} /></button>
    </div>
  );
}
