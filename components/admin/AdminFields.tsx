"use client";
import { dateShortcuts, type DateShortcutKind } from "@/lib/date-shortcuts";
import { integerDraft } from "@/lib/quantity-control";
import { normalizeHex } from "@/lib/storefront-theme";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Checkbox as SharedCheckbox,
  Input as SharedInput,
  MoneyInput,
  Select as SharedSelect,
  SegmentedField as SharedSegmented,
  Switch as SharedSwitch,
  Textarea as SharedTextarea,
  PhoneField as SharedPhoneField,
  EmailField as SharedEmailField,
  PercentField as SharedPercentField,
  CityAutocomplete as SharedCityAutocomplete,
  BancoCombobox as SharedBancoCombobox,
  Tooltip as SharedTooltip,
} from "owncoding-ui";
import {
  CITY_OPTIONS,
  amountExceeds,
  amountInput,
  DEFAULT_PHONE_COUNTRY,
  digitsOnly,
  FIELD_LIMITS,
  FIELD_MESSAGES,
  normalizeEmail,
  moneyInputDisplay,
  normalizePhone,
  normalizeSerial,
  rucInput,
  parsePercent,
  parsePhone,
  percentInput,
  PIN_MAX_DIGITS,
  PIN_MIN_DIGITS,
  PIN_SETTLE_MS,
  pinEntryComplete,
  pinInput,
  pinValid,
} from "@/lib/field-rules";
import { detectPaymentProofMime } from "@/lib/admin-types";
import { dayInputText, maskDayInput, parseDayInput } from "@/lib/admin-format";
import { matchesQuery } from "@/lib/admin-policy";
import { AdminIcon } from "./AdminIcons";

/**
 * Kit canónico de campos del panel: un componente por tipo de dato.
 *
 * Todos comparten label arriba (`htmlFor`), `aria-invalid` + `aria-describedby`,
 * error con `role="alert"` y hint o error (nunca ambos). Los campos limpian el
 * valor antes de entregarlo (el API revalida siempre) y permiten uso inline
 * sin label visible: en ese caso exigen `ariaLabel`.
 */

/** Anchos de campo de la biblioteca: xs (código, número, %), sm (monto, fecha), md (teléfono, RUC, select), lg (nombre, correo) y full (dirección, notas). */
export type FieldSize = "xs" | "sm" | "md" | "lg" | "full";

type FieldChromeProps = {
  /** Label visible arriba del control; sin label se usa `ariaLabel`. */
  label?: string;
  /** Acción junto al label (por ejemplo, "¿La olvidaste?"). */
  labelAction?: React.ReactNode;
  /** Ayuda explicativa, disponible con hover, foco o toque. */
  help?: string;
  /** Nombre accesible cuando el campo va inline (tablas, formularios de fila). */
  ariaLabel?: string;
  hint?: string;
  error?: string | null;
  /** Confirmación en verde (por ejemplo, RUC encontrado); no reemplaza al error. */
  success?: string | null;
  /** Marca el label con «*» en el acento. */
  required?: boolean;
  /** Muestra «opcional» a la derecha del label. */
  optional?: boolean;
  wide?: boolean;
  /** Ancho por tipo de campo (la biblioteca fija el de cada pieza). */
  size?: FieldSize;
  htmlFor?: string;
  hintId?: string;
  errorId?: string;
};

function describedBy(error: string | null | undefined, hint: string | undefined, hintId: string, errorId: string): string | undefined {
  if (error) return errorId;
  if (hint) return hintId;
  return undefined;
}

/** Objeto único de ayuda de campo: reutiliza el Tooltip publicado. */
export function AdminFieldHelp({ label, text }: { label: string; text: string }) {
  return <span className="admin-field-help"><SharedTooltip label={`Ayuda sobre ${label}`} trigger={<AdminIcon name="info" size={16} />}>
    <span className="admin-field-help-text">{text}</span>
  </SharedTooltip></span>;
}

function FieldChrome({ label, labelAction, help, ariaLabel, hint, error, success, required, optional, wide, size, htmlFor, hintId, errorId, children }: FieldChromeProps & { children: React.ReactNode }) {
  const message = error ? (
    <span className="admin-field-error" id={errorId} role="alert">
      {error}
    </span>
  ) : success ? (
    <span className="admin-field-success" id={hintId}>
      {success}
    </span>
  ) : hint ? (
    <span className="admin-field-hint" id={hintId}>
      {hint}
    </span>
  ) : null;
  if (!label && !message && !help) return <>{children}</>;
  const state = error ? "invalid" : success ? "valid" : undefined;
  const labelNode = label ? (
    <label className="admin-field-label" htmlFor={htmlFor}>
      {label}
      {required ? <span className="admin-field-req" aria-hidden="true"> *</span> : null}
    </label>
  ) : null;
  return (
    <div className={wide ? "admin-field admin-field--wide" : "admin-field"} data-state={state} data-size={wide ? "full" : size}>
      {label ? (
        labelAction || help || (optional && !required) ? (
          <span className="admin-field-heading">
            {labelNode}
            {help ? <AdminFieldHelp label={label} text={help} /> : null}
            {optional && !required ? <span className="admin-field-optional">opcional</span> : null}
            {labelAction}
          </span>
        ) : (
          labelNode
        )
      ) : help ? (
        <span className="admin-field-heading">
          <span className="admin-field-label" hidden>{ariaLabel}</span>
          <AdminFieldHelp label={ariaLabel ?? "este campo"} text={help} />
        </span>
      ) : (
        <span className="admin-field-label" hidden>{ariaLabel}</span>
      )}
      {children}
      {message}
    </div>
  );
}

function useFieldIds(id?: string) {
  const generated = useId();
  const fieldId = id ?? generated;
  return { fieldId, hintId: `${fieldId}-hint`, errorId: `${fieldId}-error` };
}

/** Completa atributos que algunos controles compartidos no exponen aún. */
function useSharedInputAttributes(attributes: { id: string; value: string; error?: string | null; describedBy?: string; ariaLabel?: string; name?: string; required?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector('input[type="tel"]') ?? ref.current?.querySelector("input:not([type=hidden])");
    if (!input) return;
    input.id = attributes.id;
    if (attributes.name) input.setAttribute("name", attributes.name);
    if (attributes.ariaLabel) input.setAttribute("aria-label", attributes.ariaLabel);
    input.toggleAttribute("required", Boolean(attributes.required));
    if (attributes.error) input.setAttribute("aria-invalid", "true");
    if (attributes.describedBy) input.setAttribute("aria-describedby", attributes.describedBy);
    else input.removeAttribute("aria-describedby");
  });
  return ref;
}

export type TextFieldProps = {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "search" | "tel" | "url";
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  /** Confirmación en verde bajo el campo (por ejemplo, dato verificado). */
  success?: string | null;
  /** «opcional» a la derecha del label. */
  optional?: boolean;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  autoComplete?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  /** Foco al abrir el formulario (alta rápida, issue #106). */
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  /** `id` de un `<datalist>` con el catálogo del campo (bancos, ciudades…). */
  list?: string;
  className?: string;
  title?: string;
  /** Prefijo fijo dentro del campo (por ejemplo «https://»). */
  prefix?: string;
  /** Sufijo fijo dentro del campo (por ejemplo «días», «%», «kg»). */
  suffix?: string;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
};

export function TextField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  type = "text",
  maxLength,
  minLength,
  required,
  placeholder,
  hint,
  error,
  success,
  optional,
  wide, size,
  autoComplete,
  inputMode,
  autoCapitalize,
  autoFocus,
  disabled,
  readOnly,
  name,
  id,
  list,
  className,
  title,
  prefix,
  suffix,
  onFocus,
  onBlur,
}: TextFieldProps) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} optional={optional} success={success} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "lg"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedInput
        id={label ? fieldId : id}
        className={className}
        estado={success && !error ? "ok" : undefined}
        inicio={prefix ? <span className="text-xs font-semibold">{prefix}</span> : undefined}
        fin={suffix ? <span className="text-xs font-semibold">{suffix}</span> : undefined}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        minLength={minLength}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        list={list}
        title={title}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint ?? success ?? undefined, hintId, errorId)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </FieldChrome>
  );
}

export type TextAreaFieldProps = {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  /** «opcional» a la derecha del label. */
  optional?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Ref del `<textarea>` cuando el llamador inserta texto en el cursor (chips de variables). */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** La altura sigue al contenido (hasta 12 filas); `false` deja las `rows` fijas. */
  autoGrow?: boolean;
  /** Contador «120/500» con aviso al 90 % (usa `maxLength`). */
  counter?: boolean;
};

export function TextAreaField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  maxLength = FIELD_LIMITS.notes,
  rows = 3,
  required,
  placeholder,
  hint,
  error,
  wide, size,
  optional,
  disabled,
  name,
  id,
  textareaRef,
  autoGrow = false,
  counter = false,
}: TextAreaFieldProps) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} optional={optional} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "full"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedTextarea
        ref={textareaRef}
        id={label ? fieldId : id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        autoCrecer={autoGrow}
        filasMax={12}
        contador={counter}
        rows={rows}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      />
    </FieldChrome>
  );
}

/** Color de marca: picker nativo y valor hexadecimal comparten una sola etiqueta. */
export function ColorField({ label, value, onChange, fallbackColor = "#0b5cd5", hint, error, disabled, size = "full" }: {
  label: string; value: string; onChange: (value: string) => void; fallbackColor?: string;
  hint?: string; error?: string | null; disabled?: boolean; size?: FieldSize;
}) {
  const { fieldId, hintId, errorId } = useFieldIds();
  const pickerColor = normalizeHex(value) ?? normalizeHex(fallbackColor) ?? "#0b5cd5";
  return <FieldChrome label={label} hint={hint} error={error} size={size} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
    <div className="admin-color-control">
      <input type="color" value={pickerColor} onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label={`Elegir ${label.toLowerCase()}`} aria-describedby={describedBy(error, hint, hintId, errorId)} />
      <SharedInput id={fieldId} type="text" value={value} onChange={(event) => onChange(event.target.value)} maxLength={7} placeholder={pickerColor} autoCapitalize="none" spellCheck={false} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={describedBy(error, hint, hintId, errorId)} />
    </div>
  </FieldChrome>;
}

/**
 * Monto PYG con el **`MoneyInput` de owncoding-ui** (issue #99): el componente
 * de la librería aporta el prefijo de la moneda, los separadores de miles al
 * tipear, el bloqueo de letras (teclado y pegado) y el tope con `aria-invalid`
 * + `title`. El kit solo lo envuelve con su `FieldChrome` y traduce el valor:
 * el contrato del panel sigue siendo el entero limpio (solo dígitos).
 *
 * Adaptación v0.67.1 (Refs #173): el tope efectivo es Int4; conserva el texto
 * original antes de la conversión Number y usa BigInt para representarlo.
 * Quita el maxlength del componente para avisar, nunca truncar, un exceso.
 * Sincroniza aria-invalid con el error de campo y el límite persistible.
 */
export function MoneyField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  placeholder,
  disabled,
  autoFocus,
  readOnly,
  name,
  id,
  limit = FIELD_LIMITS.amountGeneral,
  compact = true,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  /** Tope del campo (marca el aviso; el API revalida siempre). */
  limit?: number;
  /** Ancho visual; no cambia límites ni normalización. */
  compact?: boolean;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rawInput = useRef<string | null>(null);
  const effectiveLimit = Math.min(limit, FIELD_LIMITS.amountStorage);
  const limitError = amountExceeds(amountInput(value), effectiveLimit) ? FIELD_MESSAGES.amountLimit : null;
  const fieldError = error || limitError;
  const invalid = Boolean(fieldError);
  // El `MoneyInput` de la librería decide `aria-invalid` por su cuenta (tope):
  // acá se completa con el error del campo, que la librería no ve.
  useEffect(() => {
    const input = wrapperRef.current?.querySelector("input");
    if (!input) return;
    function sync() {
      if (!input) return;
      input.removeAttribute("maxlength");
      input.value = moneyInputDisplay(value);
      if (invalid) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    sync();
    // React restaura el input controlado al terminar el evento. Reparar antes
    // del siguiente paint evita la conversión Number de la librería.
    const frame = window.requestAnimationFrame(sync);
    return () => window.cancelAnimationFrame(frame);
  }, [invalid, value]);
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={fieldError} wide={wide} size={size ?? "sm"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <div className={compact ? "admin-money admin-money--compact" : "admin-money"} ref={wrapperRef}
        onInputCapture={(event) => {
          // La librería limpia el DOM antes de notificar: conservar primero el
          // texto pegado (incluido «Gs.») y enteros que excedan Number seguro.
          const input = event.target as HTMLInputElement;
          if (typeof input.value === "string") rawInput.current = input.value;
        }}>
        <MoneyInput
          id={label ? fieldId : id}
          name={name}
          value={value}
          onValueChange={() => {
            const raw = rawInput.current;
            rawInput.current = null;
            if (raw !== null) onChange(amountInput(raw));
            else onChange(amountInput(wrapperRef.current?.querySelector("input")?.value ?? ""));
          }}
          max={effectiveLimit}
          integerOnly
          required={required}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          readOnly={readOnly}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={describedBy(fieldError, hint, hintId, errorId)}
        />
      </div>
    </FieldChrome>
  );
}

/**
 * Porcentaje 0–100 con coma decimal y hasta 2 decimales, como el `PercentField`
 * de la librería: letras bloqueadas (teclado y pegado) y aviso marcado cuando
 * el valor supera 100.
 */
export function PercentField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  placeholder,
  disabled,
  name,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const clean = percentInput(value);
  const outOfRange = clean !== "" && parsePercent(clean) === null;
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "xs"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <div className="admin-money admin-money--compact">
        <SharedPercentField
          id={label ? fieldId : id}
          simbolo
          value={clean}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key.length === 1 && !/^[\d,]$/.test(event.key)) event.preventDefault();
          }}
          onChange={(next) => onChange(percentInput(next))}
          required={required}
          placeholder={placeholder}
          disabled={disabled}
          name={name}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error || outOfRange ? true : undefined}
          aria-describedby={describedBy(error, hint, hintId, errorId)}
          title={outOfRange ? FIELD_MESSAGES.percent : undefined}
        />
      </div>
    </FieldChrome>
  );
}

/** Cantidad/días: solo dígitos (`inputMode="numeric"`), sin `type="number"`. */
export function NumberField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  maxLength,
  required,
  placeholder,
  hint,
  error,
  wide, size,
  disabled,
  readOnly,
  onBlur,
  onKeyDown,
  strictInteger,
  name,
  id,
  className,
  title,
  prefix,
  suffix,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  disabled?: boolean;
  readOnly?: boolean;
  onBlur?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** Rechaza signos, decimales y exponentes; conserva el borrador vacío. */
  strictInteger?: boolean;
  name?: string;
  id?: string;
  className?: string;
  title?: string;
  /** Prefijo fijo dentro del campo. */
  prefix?: string;
  /** Unidad fija dentro del campo («días», «u.», «hs»). */
  suffix?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "xs"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedInput
        id={label ? fieldId : id}
        className={className}
        inicio={prefix ? <span className="text-xs font-semibold">{prefix}</span> : undefined}
        fin={suffix ? <span className="text-xs font-semibold">{suffix}</span> : undefined}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          const next = strictInteger ? integerDraft(event.target.value) : digitsOnly(event.target.value).replace(/^0+(?=\d)/, "");
          if (next !== null) onChange(next);
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        maxLength={maxLength}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        name={name}
        title={title}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      />
    </FieldChrome>
  );
}

/** Teléfono con código de país editable (`+` fijo) y default +595. */
export function PhoneField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  placeholder = "981 000 000",
  disabled,
  defaultCountry = DEFAULT_PHONE_COUNTRY,
  name,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  defaultCountry?: string;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const parsed = parsePhone(value, defaultCountry);
  const [emptyCountry, setEmptyCountry] = useState(defaultCountry);
  const countryCode = value.trim() ? parsed.countryCode : emptyCountry;
  const national = parsed.national;
  const sharedRef = useSharedInputAttributes({ id: fieldId, value, error, name, required, ariaLabel: label ?? ariaLabel, describedBy: describedBy(error, hint, hintId, errorId) });

  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "md"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <div ref={sharedRef} className="admin-phone-field-control">
      <SharedPhoneField
        className="admin-shared-phone"
        id={fieldId}
        name={name}
        countryCode={`+${countryCode}`}
        phone={national}
        onInternationalChange={(_e164, meta) => {
          setEmptyCountry(digitsOnly(meta.countryCode));
          onChange(normalizePhone(`${meta.countryCode} ${meta.phone}`, defaultCountry));
        }}
        placeholder={placeholder}
        disabled={disabled}
        phoneAriaLabel={label ?? ariaLabel ?? "Teléfono"}
        mensajeInvalido={FIELD_MESSAGES.phone}
        inputProps={{ id: fieldId, required, "aria-describedby": describedBy(error, hint, hintId, errorId) }}
      />
      </div>
    </FieldChrome>
  );
}

/** Ciudad con sugerencias; `catalogOnly` exige selección del catálogo y conserva valores históricos. */
export function CityField({ label, help, ariaLabel, value, onChange, onSelect, hint, error, wide, size, required, disabled, placeholder, id, name, catalogOnly = true }: {
  label?: string; help?: string; ariaLabel?: string; value: string; onChange: (value: string) => void;
  catalogOnly?: boolean;
  onSelect: (city: string, department: string) => void;
  hint?: string; error?: string | null; wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize; required?: boolean; disabled?: boolean;
  placeholder?: string; id?: string; name?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const ref = useSharedInputAttributes({ id: fieldId, value, error, name, required, ariaLabel: label ?? ariaLabel, describedBy: describedBy(error, hint, hintId, errorId) });
  if (catalogOnly) return <Combobox label={label} help={help} ariaLabel={ariaLabel} value={value}
    onChange={(city) => { const option = CITY_OPTIONS.find((entry) => entry.ciudad === city); if (option) onSelect(option.ciudad, option.departamento); else onChange(city === value ? city : ""); }}
    options={CITY_OPTIONS.map((entry) => ({ value: entry.ciudad, label: entry.ciudad, description: entry.departamento })).concat(value && !CITY_OPTIONS.some((entry) => entry.ciudad === value) ? [{ value, label: value, description: "Valor guardado anteriormente" }] : [])}
    hint={hint} error={error} wide={wide} size={size ?? "md"} required={required} disabled={disabled} placeholder={placeholder} id={fieldId} name={name} />;
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "md"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <div ref={ref} className="admin-shared-autocomplete">
        <SharedCityAutocomplete value={value} onChange={onChange} onSelect={(city: string, department?: string) => onSelect(city, department ?? "")} disabled={disabled} placeholder={placeholder} maxLength={FIELD_LIMITS.name} inputProps={{ id: fieldId, required, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy(error, hint, hintId, errorId) }} />
      </div>
    </FieldChrome>
  );
}

/** Banco libre con catálogo y selección explícita; el servidor revalida. */
export function BancoField({ label, help, ariaLabel, value, onChange, hint, error, wide, size, required, disabled, placeholder, id, name }: {
  label?: string; help?: string; ariaLabel?: string; value: string; onChange: (value: string) => void;
  hint?: string; error?: string | null; wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize; required?: boolean; disabled?: boolean;
  placeholder?: string; id?: string; name?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const ref = useSharedInputAttributes({ id: fieldId, value, error, name, required, ariaLabel: label ?? ariaLabel, describedBy: describedBy(error, hint, hintId, errorId) });
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "md"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <div ref={ref} className="admin-shared-autocomplete">
        <SharedBancoCombobox id={fieldId} value={value} onChange={onChange} required={required} disabled={disabled} placeholder={placeholder} />
      </div>
    </FieldChrome>
  );
}

/** Correo: `type=email`, máx. 200 y se guarda en minúsculas. */
export function EmailField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  placeholder,
  disabled,
  autoFocus,
  name,
  id,
  autoComplete = "email",
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  id?: string;
  autoComplete?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "lg"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedEmailField
        id={label ? fieldId : id}
        value={value}
        onChange={(next) => onChange(normalizeEmail(next))}
        maxLength={FIELD_LIMITS.email}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode="email"
        disabled={disabled}
        autoFocus={autoFocus}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      />
    </FieldChrome>
  );
}

/**
 * RUC / C.I. (issue #101): un solo componente para las identificaciones
 * tributarias del panel. Máscara de dígitos con guion opcional antes del
 * verificador (`80012345-6`, regla `rucInput` sobre `limpiarTaxId` de la
 * librería), teclado numérico y el contrato del kit (label/aria/hint/error).
 * No valida la forma del RUC: el API revalida siempre, como en el resto.
 */
export function RucField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  success,
  optional,
  wide, size,
  required,
  placeholder = "80012345-6",
  disabled,
  readOnly,
  name,
  id,
  maxLength = 20,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  success?: string | null;
  optional?: boolean;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  /** Largo máximo del documento (20 para RUC; el «RUC / CI» del cliente usa 30). */
  maxLength?: number;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} optional={optional} success={success} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "md"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedInput
        id={label ? fieldId : id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        estado={success && !error ? "ok" : undefined}
        value={rucInput(value, maxLength)}
        maxLength={maxLength}
        onChange={(event) => onChange(rucInput(event.target.value, maxLength))}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint ?? success ?? undefined, hintId, errorId)}
      />
    </FieldChrome>
  );
}

/** Serial/IMEI: mayúsculas sin espacios ni prefijos. */
export function SerialField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  placeholder,
  disabled,
  name,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "xs"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedInput
        id={label ? fieldId : id}
        type="text"
        value={value}
        onChange={(event) => onChange(normalizeSerial(event.target.value))}
        maxLength={FIELD_LIMITS.serial}
        required={required}
        placeholder={placeholder}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      />
    </FieldChrome>
  );
}

/** Opt-in: the field keeps its normal exact-date input; shortcuts only act on explicit selection. */
function DateShortcuts({ kind, value, min, max, disabled, label, onChange }: {
  kind: DateShortcutKind; value: string; min?: string; max?: string; disabled?: boolean;
  label: string; onChange: (value: string) => void;
}) {
  const [clock, setClock] = useState(() => new Date());
  const refresh = () => setClock(new Date());
  const choices = dateShortcuts({ kind, value, min, max, now: clock });
  // A keyboard user can refresh a page left open across midnight even when every old choice was out of range.
  const refreshable = !disabled && choices.every(choice => !choice.allowed);
  return <div className="admin-date-shortcuts" role="group" aria-label={`Fechas rápidas para ${label.toLowerCase()}`} tabIndex={refreshable ? 0 : undefined} onFocusCapture={refresh} onPointerEnter={refresh} onPointerDownCapture={refresh} onKeyDownCapture={refresh}>
    {choices.map(choice => {
      const detail = `${choice.label}, ${choice.dateLabel}${kind === "datetime-local" ? ` a las ${choice.value.split("T")[1]}` : ""}`;
      return <button key={choice.offset} type="button" disabled={disabled || !choice.allowed} aria-label={detail} title={choice.allowed ? detail : `${detail} · Fuera del rango permitido`} aria-pressed={value === choice.value} onClick={() => {
        // Recheck civil day and bounds at activation, including a page left open across midnight.
        const current = dateShortcuts({ kind, value, min, max })[choice.offset];
        if (!disabled && current.allowed) onChange(current.value);
      }}>{choice.label}</button>;
    })}
    {kind === "datetime-local" ? <small>Conserva la hora; vacío usa 00:00.</small> : null}
  </div>;
}

function DateLikeField({
  type,
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  min,
  max,
  disabled,
  name,
  id,
  className,
  title,
  shortcuts = false,
}: {
  type: "date" | "time" | "datetime-local";
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  title?: string;
  /** Hoy/Mañana/Pasado mañana; sólo para fechas operativas, nunca automático. */
  shortcuts?: boolean;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? (type === "time" ? "xs" : type === "date" ? "sm" : "md")} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedInput
        id={label ? fieldId : id}
        className={className}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        name={name}
        title={title}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      />
      {shortcuts && type !== "time" ? <DateShortcuts kind={type} value={value} min={min} max={max} disabled={disabled} label={label ?? ariaLabel ?? "Fecha"} onChange={(next) => { if (next !== value) onChange(next); }} /> : null}
    </FieldChrome>
  );
}

export function DateField(props: Omit<React.ComponentProps<typeof DateLikeField>, "type">) {
  return <DateLikeField {...props} type="date" />;
}

export function TimeField(props: Omit<React.ComponentProps<typeof DateLikeField>, "type" | "shortcuts">) {
  return <DateLikeField {...props} type="time" />;
}

export function DateTimeField(props: Omit<React.ComponentProps<typeof DateLikeField>, "type">) {
  return <DateLikeField {...props} type="datetime-local" />;
}

/**
 * Fecha de día puro en formato es-PY (issue #154): el input nativo (`DateField`)
 * muestra `yyyy-mm-dd` según el navegador; este campo se teclea y se lee
 * `dd/mm/aaaa`, y por dentro sigue viajando como clave `AAAA-MM-DD`.
 *
 * Solo entrega un valor cuando el día existe y entra en `min`/`max`; si el
 * texto queda incompleto o inválido, limpia el valor y muestra el error recién
 * al completar los 10 caracteres. El servidor revalida siempre.
 */
export function DayField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  min,
  max,
  disabled,
  className,
  title,
  shortcuts = false,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  /** Día en `AAAA-MM-DD` (vacío = sin fecha). */
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  /** Límite inferior inclusive, en `AAAA-MM-DD`. */
  min?: string;
  /** Límite superior inclusive, en `AAAA-MM-DD`. */
  max?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** Hoy/Mañana/Pasado mañana; sólo para fechas operativas, nunca automático. */
  shortcuts?: boolean;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const [text, setText] = useState(() => dayInputText(value));
  const [rangeError, setRangeError] = useState("");

  // El valor externo manda (limpiar filtros, atajos), pero no pisa lo que se
  // está tecleando cuando el texto actual todavía no forma un día.
  useEffect(() => {
    setText((current) => ((parseDayInput(current) ?? "") === value ? current : dayInputText(value)));
  }, [value]);

  function update(raw: string) {
    const masked = maskDayInput(raw);
    setText(masked);
    const dayKey = parseDayInput(masked);
    if (!dayKey) {
      setRangeError(masked.length === 10 ? "Ingresá un día válido (dd/mm/aaaa)." : "");
      if (value) onChange("");
      return;
    }
    if (min && dayKey < min) {
      setRangeError(`La fecha no puede ser anterior al ${dayInputText(min)}.`);
      return;
    }
    if (max && dayKey > max) {
      setRangeError(`La fecha no puede ser posterior al ${dayInputText(max)}.`);
      return;
    }
    setRangeError("");
    if (dayKey !== value) onChange(dayKey);
  }

  const message = error ?? rangeError;
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={message} wide={wide} size={size ?? "sm"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedInput
        id={label ? fieldId : id}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={text}
        onChange={(event) => update(event.target.value)}
        required={required}
        disabled={disabled}
        title={title}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(message, hint, hintId, errorId)}
      />
      {shortcuts ? <DateShortcuts kind="date" value={value} min={min} max={max} disabled={disabled} label={label ?? ariaLabel ?? "Fecha"} onChange={(next) => { setText(dayInputText(next)); setRangeError(""); if (next !== value) onChange(next); }} /> : null}
    </FieldChrome>
  );
}

/** Catálogo cerrado: nunca texto libre. */
export function SelectField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  options,
  hint,
  error,
  wide, size,
  required,
  disabled,
  name,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "md"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <SharedSelect
        id={label ? fieldId : id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SharedSelect>
    </FieldChrome>
  );
}

/**
 * Catálogo con búsqueda (docs/REGLAS-GENERALES.md §1): sugiere y completa
 * mientras se escribe, sin `<input>` suelto.
 *
 * - El valor de transporte es el `value` de la opción elegida, nunca el texto
 *   tipeado: el filtro corre sobre `label`, `description` y `keywords`.
 * - Teclado completo: ↑/↓ recorren, Enter elige, Escape cierra sin elegir;
 *   `role="combobox"` + `aria-activedescendant` + listbox con `role="option"`.
 * - `onCreate` agrega al pie el alta rápida («Crear cliente», «Crear evento»)
 *   con el texto tipeado: la pantalla decide el formulario mínimo.
 * - Con `value` elegido, el botón de limpiar devuelve el campo a vacío; borrar
 *   todo el texto también limpia la selección.
 * - `required` se marca con `aria-required` y la pantalla valida al enviar
 *   (el API revalida siempre).
 */
export type ComboboxOption = {
  /** Presentación rica opcional; label/description conservan búsqueda y accesibilidad. */
  content?: React.ReactNode;
  leading?: React.ReactNode;
  /** Valor que se entrega al elegir la opción. */
  value: string;
  /** Texto principal: es lo que muestra el campo al elegir. */
  label: string;
  /** Detalle de la fila (empresa, fechas…): se muestra y también filtra. */
  description?: string;
  /** Texto extra de filtrado que no se dibuja (alias, tipos…). */
  keywords?: string;
};

export function Combobox({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  hint,
  error,
  wide, size,
  required,
  disabled,
  name,
  id,
  maxVisible = 8,
  emptyLabel = "Sin coincidencias.",
  onCreate,
  createLabel,
  onSearch,
  allowCustomValue = false,
  onSelectOption,
}: {
  /** Texto libre persistido al escribir; sólo para catálogos que lo permiten. */
  allowCustomValue?: boolean;
  /** Selección explícita; nunca se dispara al escribir texto libre. */
  onSelectOption?: (value: string) => void;
  /** Búsqueda remota opcional; conserva el contrato de selección por ID. */
  onSearch?: (query: string) => void;
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Tope de coincidencias dibujadas; el resto se avisa para acotar escribiendo. */
  maxVisible?: number;
  /** Texto del listado sin coincidencias (y sin alta disponible). */
  emptyLabel?: string;
  /** Alta rápida al pie del listado; recibe el texto tipeado (sin elegir). */
  onCreate?: (query: string) => void;
  /** Etiqueta de la fila de alta; por defecto «Crear «texto»». */
  createLabel?: (query: string) => string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const listId = `${fieldId}-list`;
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** El primer mouseup después de enfocar no debe perder el texto seleccionado. */
  const keepSelection = useRef(false);
  const [open, setOpen] = useState(false);
  /** Texto visible mientras el listado está abierto (lo tipeado o la selección). */
  const [text, setText] = useState("");
  /** Texto de filtrado: al abrir con una selección arranca vacío (todas las opciones). */
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const matches = useMemo(
    () => onSearch ? options : options.filter((option) => matchesQuery(query, [option.label, option.description, option.keywords])),
    [options, query, onSearch],
  );
  const visible = matches.slice(0, maxVisible);
  const rowCount = visible.length + (onCreate ? 1 : 0);
  const activeRow = active >= 0 && active < rowCount ? active : -1;
  const activeId =
    activeRow < 0 ? undefined : activeRow < visible.length ? `${listId}-option-${activeRow}` : `${listId}-create`;

  /**
   * Escape del listado, en captura sobre el propio campo: el diálogo que
   * contiene al combobox escucha Escape en `document` (AdminDialog) y no debe
   * cerrarse con el mismo toque que cierra las sugerencias.
   */
  useEffect(() => {
    if (!open) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setText("");
      setQuery("");
      onSearch?.("");
      setActive(-1);
    }
    wrapper.addEventListener("keydown", onKeyDown, true);
    return () => wrapper.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  function openList() {
    setText(selected?.label ?? (allowCustomValue ? value : ""));
    setQuery("");
    onSearch?.("");
    const index = selected ? options.findIndex((option) => option.value === selected.value) : -1;
    setActive(index >= 0 && index < maxVisible ? index : -1);
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    setText("");
    setQuery("");
    onSearch?.("");
    setActive(-1);
  }

  function choose(option: ComboboxOption) {
    onChange(option.value);
    onSelectOption?.(option.value);
    closeList();
    inputRef.current?.focus();
  }

  /** Alta rápida: cierra el listado y entrega el texto tipeado tal cual. */
  function create() {
    if (!onCreate) return;
    const typed = query.trim();
    closeList();
    onCreate(typed);
  }

  function clear() {
    // Si el campo está enfocado, el listado sigue abierto con todo el catálogo;
    // si no, queda cerrado y el campo muestra el placeholder.
    onChange("");
    setText("");
    setQuery("");
    onSearch?.("");
    setActive(-1);
  }

  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "lg"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <span className="admin-combobox" ref={wrapperRef} data-rich-selection={!open && (selected?.content || selected?.leading) ? "true" : undefined}>
        {!open && (selected?.content || selected?.leading) ? <span className="admin-combobox-selected" aria-hidden="true">{selected.leading}{selected.content ?? <span>{selected.label}</span>}</span> : null}
        <input
          ref={inputRef}
          id={fieldId}
          name={name}
          type="text"
          value={open ? text : selected?.label ?? (allowCustomValue ? value : "")}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-description={selected?.description}
          aria-activedescendant={open ? activeId : undefined}
          aria-required={required || undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, hintId, errorId)}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={(event) => {
            if (open || disabled) return;
            openList();
            if (selected) {
              event.currentTarget.select();
              keepSelection.current = true;
            }
          }}
          onMouseUp={(event) => {
            if (!keepSelection.current) return;
            event.preventDefault();
            keepSelection.current = false;
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            setQuery(next);
            onSearch?.(next);
            setActive(next.trim() ? 0 : -1);
            setOpen(true);
            if (allowCustomValue) onChange(next);
            // Borrar todo el texto quita la selección (el evento es opcional).
            else if (!next.trim() && value) onChange("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) openList();
              else setActive((current) => (rowCount === 0 ? -1 : Math.min(current + 1, rowCount - 1)));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) openList();
              else setActive((current) => (current <= 0 ? 0 : current - 1));
              return;
            }
            if (event.key === "Enter" && open && activeRow >= 0) {
              event.preventDefault();
              if (activeRow < visible.length) choose(visible[activeRow]);
              else create();
              return;
            }
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next && wrapperRef.current?.contains(next as Node)) return;
            closeList();
          }}
        />
        {value && !disabled ? (
          <button
            type="button"
            className="admin-combobox-clear"
            title="Quitar la selección"
            aria-label={label ? `Quitar la selección de ${label}` : "Quitar la selección"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <AdminIcon name="close" size={12} />
          </button>
        ) : null}
        {open && !disabled ? (
          <div className="admin-combobox-pop">
            <ul className="admin-combobox-list" id={listId} role="listbox" aria-label={label ?? ariaLabel ?? "Opciones"}>
              {visible.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-label={[option.label, option.description].filter(Boolean).join(" · ")}
                  data-active={activeRow === index ? "true" : undefined}
                  className="admin-combobox-option"
                  title={option.description ? `${option.label} · ${option.description}` : option.label}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className="admin-combobox-option-content" aria-hidden="true">
                    {option.leading}
                    {option.content ?? <span className="admin-combobox-option-text">
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>}
                  </span>
                  {option.value === value ? <AdminIcon name="check" size={13} /> : null}
                </li>
              ))}
              {onCreate ? (
                <li
                  id={`${listId}-create`}
                  role="option"
                  aria-selected={false}
                  data-active={activeRow === visible.length ? "true" : undefined}
                  className="admin-combobox-option admin-combobox-option--create"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={create}
                >
                  <span className="admin-combobox-option-text">
                    <strong>
                      {createLabel ? createLabel(query) : query.trim() ? `Crear «${query.trim()}»` : "Crear nuevo"}
                    </strong>
                  </span>
                  <AdminIcon name="plus" size={13} />
                </li>
              ) : null}
            </ul>
            {matches.length > visible.length ? (
              <p className="admin-combobox-note">
                Mostrando {visible.length} de {matches.length}: seguí escribiendo para acotar.
              </p>
            ) : null}
            {matches.length === 0 && !onCreate ? <p className="admin-combobox-note">{emptyLabel}</p> : null}
          </div>
        ) : null}
      </span>
    </FieldChrome>
  );
}

/** Booleano: interruptor con `onChange(event.target.checked)`. */
export function SwitchField({
  label,
  help,
  ariaLabel,
  checked,
  onChange,
  hint,
  stateLabels,
  error,
  wide,
  disabled,
  name,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  stateLabels?: { checked: string; unchecked: string };
  error?: string | null;
  wide?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <label className="admin-switch">
        <SharedSwitch
          id={fieldId}
          {...{ name }}
          checked={checked}
          disabled={disabled}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
          ariaLabel={label ? undefined : ariaLabel}
        />
        <span className="admin-switch-state">{checked ? stateLabels?.checked ?? "Sí" : stateLabels?.unchecked ?? "No"}</span>
      </label>
    </FieldChrome>
  );
}

/**
 * Casilla del kit: una opción sí/no con su texto al lado (selección en filas,
 * "no incluido", tareas). Para ajustes con efecto inmediato se usa
 * `SwitchField`. El control real queda oculto y el dibujo es `.admin-check-box`.
 */
/** Native exclusive-choice control. The surrounding rich label/fieldset belongs to its consumer. */
export function RadioControl(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...props} type="radio" />;
}

export function CheckboxField({
  checked,
  onChange,
  text,
  ariaLabel,
  tone,
  title,
  disabled,
  name,
  id,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto visible junto a la casilla. */
  text?: string;
  /** Nombre accesible; obligatorio si no hay `text` o si el texto no alcanza. */
  ariaLabel?: string;
  /** Color del texto según el estado real (cumplido, sin subir, falló). */
  tone?: "ok" | "warn" | "danger";
  title?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
}) {
  return (
    <span className={className ? `admin-check ${className}` : "admin-check"} data-tone={tone} title={title}>
      <SharedCheckbox
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
        ariaLabel={ariaLabel}
        label={text}
        className="admin-check-label"
      />
    </span>
  );
}

/** Contraseña con mostrar/ocultar obligatorio. */
export function PasswordField({
  label,
  help,
  labelAction,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide, size,
  required,
  minLength,
  maxLength = 128,
  autoComplete = "new-password",
  disabled,
  name,
  id,
}: {
  label?: string;
  help?: string;
  labelAction?: React.ReactNode;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const [visible, setVisible] = useState(false);
  return (
    <FieldChrome
      label={label}
      help={help}
      labelAction={labelAction}
      ariaLabel={ariaLabel}
      hint={hint}
      error={error}
      wide={wide} size={size ?? "md"}
      htmlFor={fieldId}
      hintId={hintId}
      errorId={errorId}
    >
      <span className="admin-password">
        <input
          id={fieldId}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, hintId, errorId)}
        />
        <button
          type="button"
          className="admin-password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          <AdminIcon name={visible ? "eye-off" : "eye"} size={15} />
        </button>
      </span>
    </FieldChrome>
  );
}

/** Búsqueda: lupa + limpiar; el debounce vive en la pantalla. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = "Buscar…",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <div className="admin-search">
      <AdminIcon name="search" size={15} />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
      />
      {value ? (
        <button type="button" className="admin-search-clear" onClick={() => onChange("")} aria-label="Limpiar búsqueda" title="Limpiar búsqueda">
          <AdminIcon name="close" size={12} />
        </button>
      ) : null}
    </div>
  );
}

/** Trampa anti-bot de los formularios de acceso: invisible, fuera del tabulado. */
export function HoneypotField({ name = "website" }: { name?: string }) {
  return <input className="admin-honeypot" name={name} tabIndex={-1} autoComplete="off" aria-hidden="true" />;
}

/**
 * PIN del panel (issue #21): 4–6 dígitos, **nunca visible** (sin ojo, siempre
 * `type=password`), teclado numérico (`inputMode="numeric"`) y validación al
 * completarlo (`autoSubmit` avisa al llegar al máximo). El valor que entrega ya
 * viene limpio (`pinInput`, solo dígitos) y el API lo revalida.
 *
 * Los puntos son la parte visible; el `<input>` vive encima, transparente, para
 * que el teclado del celular y el pegado funcionen igual. La pantalla de bloqueo
 * le pasa su propio `inputRef` para que el teclado en pantalla no le robe el foco.
 */
export function PinField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  length = PIN_MAX_DIGITS,
  autoSubmit,
  onComplete,
  expectedLength,
  hint,
  error,
  wide, size,
  required,
  disabled,
  autoFocus,
  name,
  id,
  inputRef,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  /** Máximo de dígitos que se pueden teclear (4–6). */
  length?: number;
  /** Al completar `length` dígitos llama a `onComplete` (validación inmediata). */
  autoSubmit?: boolean;
  onComplete?: (value: string) => void;
  /**
   * Largo conocido del PIN (issue #54): al llegar a esa cantidad se envía sin
   * pausa. Sirve para repetir un PIN nuevo sin adivinar si es de 4 o de 6.
   */
  expectedLength?: number | null;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  id?: string;
  /** Ref del `<input>` cuando el llamador necesita devolverle el foco (teclado en pantalla). */
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const localRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  function assignRef(node: HTMLInputElement | null) {
    localRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
  }

  function emit(next: string) {
    onChange(pinInput(next));
  }

  /**
   * Envío automático (issue #54): al llegar al largo esperado (o a 6) se envía al
   * instante; con 4 o más dígitos, una pausa breve cierra el PIN corto sin Enter.
   * Cada tecla reinicia la pausa, así quien va a escribir 6 no se corta.
   */
  useEffect(() => {
    if (!autoSubmit || disabled) return;
    if (pinEntryComplete(value, 0, expectedLength)) {
      completeRef.current?.(value);
      return;
    }
    if (!pinValid(value)) return;
    const timer = window.setTimeout(() => {
      if (pinEntryComplete(value, PIN_SETTLE_MS, expectedLength)) completeRef.current?.(value);
    }, PIN_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [value, autoSubmit, disabled, expectedLength]);

  return (
    <FieldChrome required={required} label={label} help={help} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} size={size ?? "xs"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <span className="admin-pin" data-focused={focused ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
        <span className="admin-pin-slots" aria-hidden="true">
          {Array.from({ length }, (_, index) => (
            <span
              key={index}
              className="admin-pin-slot"
              data-filled={index < value.length ? "true" : undefined}
              data-active={index === value.length && !disabled ? "true" : undefined}
              data-min-boundary={index === PIN_MIN_DIGITS ? "true" : undefined}
            >
              <span className="admin-pin-slot-dot" />
            </span>
          ))}
        </span>
        <input
          ref={assignRef}
          id={fieldId}
          name={name}
          className="admin-pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          spellCheck={false}
          aria-label={label ? undefined : (ariaLabel ?? "PIN")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, hintId, errorId)}
          onChange={(event) => emit(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </span>
    </FieldChrome>
  );
}

/**
 * 2–5 opciones excluyentes: barra con `aria-pressed` (un solo control para
 * catálogos chicos, sin select ni radios sueltos).
 */
export function SegmentedField({
  label,
  help,
  ariaLabel,
  value,
  onChange,
  options,
  hint,
  error,
  wide, size,
  disabled,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  disabled?: boolean;
}) {
  const { fieldId, hintId, errorId } = useFieldIds();
  const labelId = `${fieldId}-label`;
  const name = label ?? ariaLabel ?? "";
  const message = error ? (
    <span className="admin-field-error" id={errorId} role="alert">
      {error}
    </span>
  ) : hint ? (
    <span className="admin-field-hint" id={hintId}>
      {hint}
    </span>
  ) : null;
  return (
    <div className={wide ? "admin-field admin-field--wide" : "admin-field"} data-size={wide ? "full" : (size ?? (options.length > 3 ? "full" : "lg"))}>
      {label ? (
        help ? <span className="admin-field-heading">
          <span className="admin-field-label" id={labelId}>{label}</span>
          <AdminFieldHelp label={label} text={help} />
        </span> : <span className="admin-field-label" id={labelId}>{label}</span>
      ) : help ? (
        <span className="admin-field-heading"><AdminFieldHelp label={ariaLabel ?? "este campo"} text={help} /></span>
      ) : (
        <span className="admin-field-label" hidden>
          {ariaLabel}
        </span>
      )}
      <div
        role="group"
        aria-label={label ? undefined : name}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
        aria-invalid={error ? true : undefined}
        aria-disabled={disabled ? true : undefined}
        inert={disabled ? true : undefined}
      >
        <SharedSegmented
          value={value}
          onChange={(next: string) => { if (!disabled) onChange(next); }}
          options={options.map((option): [string, string] => [option.value, option.label])}
          ariaLabel={name}
          className={disabled ? "admin-segmented pointer-events-none opacity-50" : "admin-segmented"}
        />
      </div>
      {message}
    </div>
  );
}

/**
 * Archivo adjunto (docs/REGLAS-GENERALES.md): JPG/PNG/WebP/PDF hasta 5 MiB,
 * validado por MIME real (magic bytes) antes de entregarlo. Un solo objeto para
 * todos los adjuntos del panel; el que sube decide el destino (endpoint).
 */
export function AttachmentInput({
  label = "Adjunto",
  help,
  ariaLabel,
  hint,
  error,
  wide, size,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
  maxBytes = 5 * 1024 * 1024,
  disabled,
  onSelect,
  id,
}: {
  label?: string;
  help?: string;
  ariaLabel?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
  onSelect: (file: File | null) => void;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localError, setLocalError] = useState("");
  const shown = error || localError || null;

  async function pick(file: File | null) {
    setLocalError("");
    if (!file) {
      onSelect(null);
      return;
    }
    if (file.size === 0) {
      setLocalError("El archivo está vacío; probá con otro.");
      return;
    }
    if (file.size > maxBytes) {
      setLocalError(`El archivo supera los ${Math.round(maxBytes / (1024 * 1024))} MB.`);
      return;
    }
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!detectPaymentProofMime(header)) {
      setLocalError("El archivo no es un JPG, PNG, WebP o PDF real: revisá que no esté renombrado.");
      return;
    }
    onSelect(file);
  }

  return (
    <FieldChrome
      label={label}
      help={help}
      ariaLabel={ariaLabel}
      hint={hint}
      error={shown}
      wide={wide} size={size ?? "full"}
      htmlFor={fieldId}
      hintId={hintId}
      errorId={errorId}
    >
      <span className="admin-attachment">
        <input
          id={label ? fieldId : id}
          ref={inputRef}
          className="sr-only"
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            void pick(event.target.files?.[0] ?? null);
          }}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={shown ? true : undefined}
          aria-describedby={describedBy(shown, hint, hintId, errorId)}
        />
        <button
          className="admin-btn admin-btn--ghost"
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          title="Elegir el archivo"
          aria-label="Elegir el archivo"
        >
          <AdminIcon name="upload" size={15} />
          <span>Elegir archivo</span>
        </button>
      </span>
    </FieldChrome>
  );
}

/**
 * Archivo cualquiera con tope de tamaño (importaciones: JSON, planilla, ZIP).
 * El contenido se valida en el servidor; acá solo se controla el tamaño y se
 * muestra el nombre elegido. Para fotos sueltas se usa `AttachmentInput`.
 */
export function FileField({
  label,
  help,
  hint,
  error,
  wide, size,
  accept,
  maxBytes,
  disabled,
  file,
  onSelect,
  id,
  name,
  required,
  inputRef: externalRef,
  ariaDescribedBy,
  preserveNativeSelection = Boolean(name || required),
}: {
  label: string;
  help?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  /** Ancho del campo: xs, sm, md, lg o full (por defecto el de su tipo). */
  size?: FieldSize;
  accept?: string;
  /** Raw-file cap; null explicitly delegates the cap to a validated preparation/compression flow. */
  maxBytes: number | null;
  disabled?: boolean;
  file: File | null;
  onSelect: (file: File | null) => void;
  id?: string;
  name?: string;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  ariaDescribedBy?: string;
  /** Keep native FileList for required/FormData; defaults on when named or required. */
  preserveNativeSelection?: boolean;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localError, setLocalError] = useState("");
  const shown = error || localError || null;
  useEffect(() => {
    if (preserveNativeSelection && !file && inputRef.current) inputRef.current.value = "";
  }, [file, preserveNativeSelection]);

  function assignInput(node: HTMLInputElement | null) {
    inputRef.current = node;
    if (typeof externalRef === "function") externalRef(node);
    else if (externalRef) (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
  }

  function pick(next: File | null) {
    setLocalError("");
    if (next && next.size === 0) return setLocalError("El archivo está vacío; probá con otro.");
    if (next && typeof maxBytes === "number" && next.size > maxBytes) return setLocalError(`El archivo supera los ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    onSelect(next);
    return true;
  }

  return (
    <FieldChrome required={required} label={label} help={help} hint={hint} error={shown} wide={wide} size={size ?? "full"} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <span className="admin-attachment">
        <input
          id={fieldId}
          ref={assignInput}
          className="sr-only"
          type="file"
          name={name}
          required={required}
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            const accepted = pick(event.target.files?.[0] ?? null);
            if (!preserveNativeSelection || !accepted) event.target.value = "";
          }}
          aria-invalid={shown ? true : undefined}
          aria-describedby={[describedBy(shown, hint, hintId, errorId), ariaDescribedBy].filter(Boolean).join(" ") || undefined}
        />
        <button className="admin-btn admin-btn--ghost" type="button" disabled={disabled} onClick={() => inputRef.current?.click()} aria-label={`Elegir archivo: ${label}`}>
          <AdminIcon name="upload" size={15} />
          <span>{file ? "Cambiar archivo" : "Elegir archivo"}</span>
        </button>
        {file ? (
          <span className="admin-import-file">
            {file.name} · {(file.size / 1024 / 1024 >= 1 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`)}
            <button className="admin-btn admin-btn--ghost admin-btn--only-icon" type="button" disabled={disabled} onClick={() => { if (inputRef.current) inputRef.current.value = ""; setLocalError(""); onSelect(null); }} aria-label={`Quitar ${file.name}`}>
              <AdminIcon name="close" size={14} />
            </button>
          </span>
        ) : null}
      </span>
    </FieldChrome>
  );
}
