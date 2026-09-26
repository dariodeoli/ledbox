"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  amountExceeds,
  amountInput,
  amountLimitTitle,
  caretAfterDigits,
  DEFAULT_PHONE_COUNTRY,
  digitsOnly,
  FIELD_LIMITS,
  FIELD_MESSAGES,
  moneyInputDisplay,
  moneyInputMaxLength,
  normalizeEmail,
  normalizePhone,
  normalizeSerial,
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
import { AdminIcon } from "./AdminIcons";

/**
 * Kit canónico de campos del panel: un componente por tipo de dato.
 *
 * Todos comparten label arriba (`htmlFor`), `aria-invalid` + `aria-describedby`,
 * error con `role="alert"` y hint o error (nunca ambos). Los campos limpian el
 * valor antes de entregarlo (el API revalida siempre) y permiten uso inline
 * sin label visible: en ese caso exigen `ariaLabel`.
 */

type FieldChromeProps = {
  /** Label visible arriba del control; sin label se usa `ariaLabel`. */
  label?: string;
  /** Acción junto al label (por ejemplo, "¿La olvidaste?"). */
  labelAction?: React.ReactNode;
  /** Nombre accesible cuando el campo va inline (tablas, formularios de fila). */
  ariaLabel?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  htmlFor?: string;
  hintId?: string;
  errorId?: string;
};

function describedBy(error: string | null | undefined, hint: string | undefined, hintId: string, errorId: string): string | undefined {
  if (error) return errorId;
  if (hint) return hintId;
  return undefined;
}

function FieldChrome({ label, labelAction, ariaLabel, hint, error, wide, htmlFor, hintId, errorId, children }: FieldChromeProps & { children: React.ReactNode }) {
  const message = error ? (
    <span className="admin-field-error" id={errorId} role="alert">
      {error}
    </span>
  ) : hint ? (
    <span className="admin-field-hint" id={hintId}>
      {hint}
    </span>
  ) : null;
  if (!label && !message) return <>{children}</>;
  return (
    <div className={wide ? "admin-field admin-field--wide" : "admin-field"}>
      {label ? (
        labelAction ? (
          <span className="admin-field-heading">
            <label className="admin-field-label" htmlFor={htmlFor}>
              {label}
            </label>
            {labelAction}
          </span>
        ) : (
          <label className="admin-field-label" htmlFor={htmlFor}>
            {label}
          </label>
        )
      ) : (
        <span className="admin-field-label" hidden>
          {ariaLabel}
        </span>
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

export type TextFieldProps = {
  label?: string;
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
  wide?: boolean;
  autoComplete?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  /** `id` de un `<datalist>` con el catálogo del campo (bancos, ciudades…). */
  list?: string;
  className?: string;
  title?: string;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
};

export function TextField({
  label,
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
  wide,
  autoComplete,
  inputMode,
  autoCapitalize,
  disabled,
  readOnly,
  name,
  id,
  list,
  className,
  title,
  onFocus,
  onBlur,
}: TextFieldProps) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
        id={label ? fieldId : id}
        className={className}
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
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        list={list}
        title={title}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </FieldChrome>
  );
}

export type TextAreaFieldProps = {
  label?: string;
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
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Ref del `<textarea>` cuando el llamador inserta texto en el cursor (chips de variables). */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
};

export function TextAreaField({
  label,
  ariaLabel,
  value,
  onChange,
  maxLength = FIELD_LIMITS.notes,
  rows = 3,
  required,
  placeholder,
  hint,
  error,
  wide,
  disabled,
  name,
  id,
  textareaRef,
}: TextAreaFieldProps) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <textarea
        ref={textareaRef}
        id={label ? fieldId : id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
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

/**
 * Monto PYG con el manejo de `MoneyInput` de la librería (vía los utils puros):
 * separadores de miles al tipear, letras bloqueadas (teclado y pegado) y tope
 * marcado con `aria-invalid` + `title`. El valor de transporte sigue siendo el
 * entero limpio (solo dígitos), como antes.
 */
export function MoneyField({
  label,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  placeholder,
  disabled,
  readOnly,
  name,
  id,
  limit = FIELD_LIMITS.amountGeneral,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  /** Tope del campo (marca el aviso; el API revalida siempre). */
  limit?: number;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const inputRef = useRef<HTMLInputElement>(null);
  const amount = amountInput(value);
  const exceeds = amountExceeds(amount, limit);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
        ref={inputRef}
        id={label ? fieldId : id}
        type="text"
        inputMode="numeric"
        value={moneyInputDisplay(amount)}
        maxLength={moneyInputMaxLength(limit)}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key.length === 1 && !/^\d$/.test(event.key)) event.preventDefault();
        }}
        onChange={(event) => {
          const input = event.currentTarget;
          const before = input.value.slice(0, input.selectionStart ?? input.value.length);
          const digitsBefore = (before.match(/\d/g) || []).length;
          onChange(amountInput(input.value));
          // El formateo no mueve el caret: se reubica tras la misma cantidad de dígitos.
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node || document.activeElement !== node) return;
            const caret = caretAfterDigits(node.value, digitsBefore);
            node.setSelectionRange?.(caret, caret);
          });
        }}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error || exceeds ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
        title={exceeds ? amountLimitTitle(limit) : undefined}
      />
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
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  placeholder,
  disabled,
  name,
  id,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
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
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
        id={label ? fieldId : id}
        type="text"
        inputMode="decimal"
        value={clean}
        maxLength={6}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key.length === 1 && !/^[\d,]$/.test(event.key)) event.preventDefault();
        }}
        onChange={(event) => onChange(percentInput(event.target.value))}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error || outOfRange ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
        title={outOfRange ? FIELD_MESSAGES.percent : undefined}
      />
    </FieldChrome>
  );
}

/** Cantidad/días: solo dígitos (`inputMode="numeric"`), sin `type="number"`. */
export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  maxLength,
  required,
  placeholder,
  hint,
  error,
  wide,
  disabled,
  name,
  id,
  className,
  title,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  title?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
        id={label ? fieldId : id}
        className={className}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(digitsOnly(event.target.value).replace(/^0+(?=\d)/, ""))}
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
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  placeholder = "+595 981 000 000",
  disabled,
  defaultCountry = DEFAULT_PHONE_COUNTRY,
  name,
  id,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  defaultCountry?: string;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  const { countryCode, national } = parsePhone(value, defaultCountry);

  function emit(code: string, nextNational: string) {
    onChange(normalizePhone(`+${code} ${nextNational}`, defaultCountry));
  }

  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <span className="admin-phone">
        <span className="admin-phone-prefix" aria-hidden="true">
          +
        </span>
        <input
          className="admin-phone-code"
          type="text"
          inputMode="numeric"
          value={countryCode}
          maxLength={4}
          disabled={disabled}
          aria-label={label ? "Código de país" : `${ariaLabel ?? "Teléfono"}: código de país`}
          placeholder={defaultCountry}
          onChange={(event) => emit(digitsOnly(event.target.value).slice(0, 4), national)}
        />
        <input
          id={fieldId}
          name={name}
          type="tel"
          value={national}
          maxLength={20}
          required={required}
          placeholder={placeholder}
          autoComplete="tel"
          disabled={disabled}
          onChange={(event) => emit(countryCode, event.target.value.replace(/[^\d\s().-]/g, ""))}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, hintId, errorId)}
        />
      </span>
    </FieldChrome>
  );
}

/** Correo: `type=email`, máx. 200 y se guarda en minúsculas. */
export function EmailField({
  label,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  placeholder,
  disabled,
  name,
  id,
  autoComplete = "email",
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  autoComplete?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
        id={label ? fieldId : id}
        type="email"
        value={value}
        onChange={(event) => onChange(normalizeEmail(event.target.value))}
        maxLength={FIELD_LIMITS.email}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode="email"
        disabled={disabled}
        name={name}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
      />
    </FieldChrome>
  );
}

/** Serial/IMEI: mayúsculas sin espacios ni prefijos. */
export function SerialField({
  label,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  placeholder,
  disabled,
  name,
  id,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
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

function DateLikeField({
  type,
  label,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  min,
  max,
  disabled,
  name,
  id,
  className,
  title,
}: {
  type: "date" | "time" | "datetime-local";
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  title?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <input
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
    </FieldChrome>
  );
}

export function DateField(props: Omit<React.ComponentProps<typeof DateLikeField>, "type">) {
  return <DateLikeField {...props} type="date" />;
}

export function TimeField(props: Omit<React.ComponentProps<typeof DateLikeField>, "type">) {
  return <DateLikeField {...props} type="time" />;
}

export function DateTimeField(props: Omit<React.ComponentProps<typeof DateLikeField>, "type">) {
  return <DateLikeField {...props} type="datetime-local" />;
}

/** Catálogo cerrado: nunca texto libre. */
export function SelectField({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  hint,
  error,
  wide,
  required,
  disabled,
  name,
  id,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <select
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
      </select>
    </FieldChrome>
  );
}

/** Booleano: interruptor con `onChange(event.target.checked)`. */
export function SwitchField({
  label,
  ariaLabel,
  checked,
  onChange,
  hint,
  error,
  wide,
  disabled,
  name,
  id,
}: {
  label?: string;
  ariaLabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
}) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
      <label className="admin-switch">
        <input
          id={fieldId}
          name={name}
          className="admin-switch-input"
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={label ? undefined : ariaLabel}
        />
        <span className="admin-switch-track" aria-hidden="true" />
        <span className="admin-switch-state">{checked ? "Sí" : "No"}</span>
      </label>
    </FieldChrome>
  );
}

/** Contraseña con mostrar/ocultar obligatorio. */
export function PasswordField({
  label,
  labelAction,
  ariaLabel,
  value,
  onChange,
  hint,
  error,
  wide,
  required,
  minLength,
  maxLength = 128,
  autoComplete = "new-password",
  disabled,
  name,
  id,
}: {
  label?: string;
  labelAction?: React.ReactNode;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  wide?: boolean;
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
      labelAction={labelAction}
      ariaLabel={ariaLabel}
      hint={hint}
      error={error}
      wide={wide}
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
  ariaLabel,
  value,
  onChange,
  length = PIN_MAX_DIGITS,
  autoSubmit,
  onComplete,
  expectedLength,
  hint,
  error,
  wide,
  required,
  disabled,
  autoFocus,
  name,
  id,
  inputRef,
}: {
  label?: string;
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
    <FieldChrome label={label} ariaLabel={ariaLabel} hint={hint} error={error} wide={wide} htmlFor={fieldId} hintId={hintId} errorId={errorId}>
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
  ariaLabel,
  value,
  onChange,
  options,
  hint,
  error,
  wide,
  disabled,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  error?: string | null;
  wide?: boolean;
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
    <div className={wide ? "admin-field admin-field--wide" : "admin-field"}>
      {label ? (
        <span className="admin-field-label" id={labelId}>
          {label}
        </span>
      ) : (
        <span className="admin-field-label" hidden>
          {ariaLabel}
        </span>
      )}
      <div
        className="admin-segmented"
        role="group"
        aria-label={label ? undefined : name}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={describedBy(error, hint, hintId, errorId)}
        aria-invalid={error ? true : undefined}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="admin-segmented-item"
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
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
  ariaLabel,
  hint,
  error,
  wide,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
  maxBytes = 5 * 1024 * 1024,
  disabled,
  onSelect,
  id,
}: {
  label?: string;
  ariaLabel?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
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
      ariaLabel={ariaLabel}
      hint={hint}
      error={shown}
      wide={wide}
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
