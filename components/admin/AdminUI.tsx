"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PIN_MIN_DIGITS, pinInput, pinValid } from "@/lib/field-rules";
import type { AdminIconName, AdminTimelineEntry, AdminTimelineKind } from "@/lib/admin-types";
import {
  countdownTone,
  formatCountdown,
  formatDateTime,
  formatNumber,
  timelineKindLabel,
  whatsappHref,
  type AdminTone,
} from "@/lib/admin-format";
import { adminApiGet } from "@/lib/admin-api";
import { prepareIdentityImage, type PreparedIdentityImage } from "@/lib/identity-image";
import { BrandMark } from "@/components/brand-mark";
import { AdminIcon } from "./AdminIcons";
import { AdminAvatar } from "./AdminAvatar";
import { PinField } from "./AdminFields";
import { WhatsappIcon } from "../whatsapp/WhatsappIcon";

/** Primitivas del panel: un solo diseño por tipo (botón, badge, campo, tabla, estado vacío). */

export function AdminSpinner({ label = "Cargando" }: { label?: string }) {
  return <span className="admin-spinner" role="status" aria-label={label} />;
}

export function AdminError({ message }: { message: string }) {
  return (
    <AdminNote tone="error" variant="alert">
      {message}
    </AdminNote>
  );
}

export function AdminSuccess({ children }: { children: React.ReactNode }) {
  return (
    <AdminNote tone="ok" variant="alert">
      {children}
    </AdminNote>
  );
}

type AdminButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "icon";
  icon?: AdminIconName;
  busy?: boolean;
};

export function AdminButton({ variant = "ghost", icon, busy, children, className, disabled, ...rest }: AdminButtonProps) {
  const classes = ["admin-btn"];
  if (variant === "primary") classes.push("admin-btn--primary");
  if (!children) classes.push("admin-btn--only-icon");
  if (className) classes.push(className);
  return (
    <button {...rest} className={classes.join(" ")} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <AdminSpinner label="Guardando" /> : icon ? <AdminIcon name={icon} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function AdminIconLink({ href, icon, label, external }: { href: string; icon: AdminIconName; label: string; external?: boolean }) {
  return (
    <a
      className="admin-iconbtn"
      href={href}
      title={label}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      <AdminIcon name={icon} size={15} />
    </a>
  );
}

/** Link de WhatsApp con el teléfono normalizado; no se dibuja si no hay número válido. */
export function AdminWhatsappLink({ phone, name }: { phone: string | null | undefined; name: string }) {
  const href = whatsappHref(phone);
  if (!href) return null;
  const label = `Escribir por WhatsApp a ${name}`;
  return (
    <a className="admin-iconbtn" href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}>
      <WhatsappIcon size={15} />
    </a>
  );
}

export function AdminBadge({ tone = "neutral", title, children }: { tone?: AdminTone; title?: string; children: React.ReactNode }) {
  return (
    <span className="admin-badge" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/**
 * Cuánto falta para una fecha, con el texto y el tono compartidos (issue #25).
 * Es el único chip de cuenta regresiva del panel: «faltan 3 días» · «venció hace
 * 2 días» · «hoy» · «mañana»; `short` para columnas ajustadas («en 3 d»).
 * Sin fecha no dibuja nada: el llamador decide si muestra «—».
 */
export function AdminCountdown({
  value,
  short,
  title,
  className,
}: {
  value: string | Date | null | undefined;
  /** Texto corto («en 3 d» / «hace 2 d») para lugares ajustados. */
  short?: boolean;
  /** Tooltip propio; sin él explica la cuenta regresiva. */
  title?: string;
  /** Clase extra (`admin-countdown--inline` agrega la separación del dato vecino). */
  className?: string;
}) {
  if (!value) return null;
  const text = formatCountdown(value, short ? "short" : "panel");
  if (text === "—") return null;
  return (
    <span
      className={className ? `admin-countdown ${className}` : "admin-countdown"}
      data-tone={countdownTone(value)}
      title={title ?? `Cuánto falta: ${text}`}
    >
      {text}
    </span>
  );
}

/** Aviso inline único del panel: `note` en formularios y bloques, `alert` en las tarjetas de acceso. */
export function AdminNote({
  children,
  tone,
  variant = "note",
}: {
  children: React.ReactNode;
  tone?: "ok" | "error";
  variant?: "note" | "alert";
}) {
  if (variant === "alert") {
    return (
      <p className={tone === "error" ? "admin-alert admin-alert--error" : "admin-alert admin-alert--success"} role={tone === "error" ? "alert" : "status"}>
        {children}
      </p>
    );
  }
  return (
    <p className="admin-note" role={tone === "error" ? "alert" : "status"} data-tone={tone}>
      {children}
    </p>
  );
}

export function AdminEmpty({ title, hint, icon = "info" }: { title: string; hint?: string; icon?: AdminIconName }) {
  return (
    <div className="admin-empty">
      <AdminIcon name={icon} size={22} />
      <p className="admin-empty-title">{title}</p>
      {hint ? <p className="admin-empty-hint">{hint}</p> : null}
    </div>
  );
}

export function AdminErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="admin-error-state" role="alert">
      <AdminIcon name="alert" size={18} />
      <span>{message}</span>
      {onRetry ? (
        <AdminButton icon="refresh" onClick={onRetry}>
          Reintentar
        </AdminButton>
      ) : null}
    </div>
  );
}

export function AdminLoadingRows({ rows = 5, label = "Cargando datos" }: { rows?: number; label?: string }) {
  return (
    <div className="admin-table-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} className="admin-skeleton-row" />
      ))}
    </div>
  );
}

/** Estado de un bloque con datos: cargando, error, vacío o contenido. */
export function AdminDataState({
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyHint,
  rows,
  children,
}: {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  rows?: number;
  children: React.ReactNode;
}) {
  if (loading) return <AdminLoadingRows rows={rows} />;
  if (error) return <AdminErrorState message={error} onRetry={onRetry} />;
  if (empty) return <AdminEmpty title={emptyTitle || "Sin registros"} hint={emptyHint} />;
  return <>{children}</>;
}

export function AdminFormPanel({
  title,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  status,
  children,
}: {
  title: string;
  submitLabel: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  busy?: boolean;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <form className="admin-form-panel" onSubmit={onSubmit} aria-busy={busy || undefined}>
      <div className="admin-form-head">
        <h2 className="admin-form-title">{title}</h2>
        <button type="button" className="admin-iconbtn" onClick={onCancel} aria-label="Cerrar formulario" title="Cerrar formulario">
          <AdminIcon name="close" size={15} />
        </button>
      </div>
      <div className="admin-form-grid">{children}</div>
      <div className="admin-form-foot">
        {status ? <AdminNote tone="error">{status}</AdminNote> : null}
        <div className="admin-form-actions">
          <AdminButton type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" variant="primary" icon="check" busy={busy}>
            {submitLabel}
          </AdminButton>
        </div>
      </div>
    </form>
  );
}

/**
 * Diálogo único del panel: overlay a pantalla completa y panel centrado.
 * Contrato mínimo: rol dialog, foco al abrir, cierre con Escape y clic afuera.
 * `wide` para las tablas chicas y `ficha` para la ficha 360 del cliente
 * (issue #34), que necesita ancho para sus listas.
 */
export function AdminDialog({
  title,
  onClose,
  size = "default",
  children,
}: {
  title: string;
  onClose: () => void;
  size?: "default" | "wide" | "ficha";
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const classes = ["admin-dialog"];
  if (size === "wide") classes.push("admin-dialog--wide");
  if (size === "ficha") classes.push("admin-dialog--ficha");
  return (
    <div
      className="admin-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={classes.join(" ")} role="dialog" aria-modal="true" aria-label={title}>
        <header className="admin-dialog-head">
          <h2 className="admin-dialog-title">{title}</h2>
          <button ref={closeRef} type="button" className="admin-iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
            <AdminIcon name="close" size={15} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

// ── Cronología (issue #33) ──────────────────────────────────────────────────
// Un ícono por tipo de hito; el tono y la fecha los pone la fuente real.

const TIMELINE_ICONS: Record<AdminTimelineKind, AdminIconName> = {
  created: "plus",
  updated: "edit",
  status: "arrow-right",
  sent: "mail",
  viewed: "eye",
  request: "edit",
  request_resolved: "check",
  approved: "check",
  revision: "alert",
  expected: "clock",
  proof: "upload",
  payment: "finance",
  treasury: "finance",
  inventory: "inventory",
  checkout: "arrow-right",
  checkin: "refresh",
  task: "audit",
  task_done: "check",
  event_date: "calendar",
  cancelled: "close",
  thanks: "info",
};

/**
 * Timeline vertical compartido: contador de hitos, filtro simple por tipo y
 * una fila por hito con fecha (24 h de Asunción), actor y detalle. Los hitos
 * llegan ya ordenados y con su tono real; el componente no interpreta nada.
 */
export function AdminTimeline({
  entries,
  loading,
  error,
  onRetry,
  emptyTitle = "Todavía no hay hitos",
  emptyHint,
}: {
  entries: AdminTimelineEntry[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const [kind, setKind] = useState("ALL");
  const kinds = useMemo(() => [...new Set(entries.map((entry) => entry.kind))], [entries]);

  // El filtro elegido sobrevive a un reload solo si el tipo sigue existiendo.
  useEffect(() => {
    if (kind !== "ALL" && !kinds.includes(kind as AdminTimelineKind)) setKind("ALL");
  }, [kind, kinds]);

  const filtered = kind === "ALL" ? entries : entries.filter((entry) => entry.kind === kind);

  return (
    <AdminDataState
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={entries.length === 0}
      emptyTitle={emptyTitle}
      emptyHint={emptyHint}
      rows={4}
    >
      <div className="admin-timeline-head">
        <span className="admin-timeline-count">
          {formatNumber(entries.length)} {entries.length === 1 ? "hito" : "hitos"}
          {kind === "ALL" ? "" : ` · ${formatNumber(filtered.length)} en el filtro`}
        </span>
        <AdminSelect
          value={kind}
          onChange={setKind}
          label="Filtrar la cronología por tipo de hito"
          options={[
            { value: "ALL", label: "Todos los tipos" },
            ...kinds.map((value) => ({ value, label: timelineKindLabel(value) })),
          ]}
        />
      </div>
      <ol className="admin-timeline">
        {filtered.map((entry) => (
          <li className="admin-timeline-step" key={entry.id} data-tone={entry.tone}>
            <span className="admin-timeline-when">{formatDateTime(entry.at)}</span>
            <span className="admin-timeline-body">
              <strong>
                <span className="admin-timeline-kind" aria-hidden="true">
                  <AdminIcon name={TIMELINE_ICONS[entry.kind]} size={12} />
                </span>
                {entry.title}
                {entry.actor ? <span className="admin-timeline-actor"> · {entry.actor}</span> : null}
              </strong>
              {entry.detail ? <small>{entry.detail}</small> : null}
              <small className="admin-timeline-meta">{timelineKindLabel(entry.kind)}</small>
            </span>
          </li>
        ))}
      </ol>
    </AdminDataState>
  );
}

/**
 * Diálogo de cronología: pide los hitos reales de un presupuesto o un evento y
 * los dibuja con el timeline compartido. Cualquier rol con membresía lee
 * (VIEWER incluido); el aislamiento por empresa lo resuelve el API.
 */
export function AdminTimelineDialog({ title, path, onClose }: { title: string; path: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AdminTimelineEntry[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    void adminApiGet<{ timeline?: AdminTimelineEntry[] }>(path, {
      fresh: attempt > 0,
      fallbackError: "No pudimos cargar la cronología.",
    }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setEntries([]);
        setError(result.error);
        return;
      }
      setEntries(result.data.timeline ?? []);
    });
    return () => {
      active = false;
    };
  }, [path, attempt]);

  return (
    <AdminDialog title={title} size="wide" onClose={onClose}>
      <AdminTimeline
        entries={entries ?? []}
        loading={entries === null && !error}
        error={error}
        onRetry={() => setAttempt((current) => current + 1)}
        emptyTitle="Todavía no hay hitos registrados"
        emptyHint="Los hitos aparecen solos cuando el presupuesto o el evento tienen movimientos reales."
      />
      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton onClick={onClose}>Cerrar</AdminButton>
      </div>
    </AdminDialog>
  );
}

export function AdminSelect({
  value,
  onChange,
  label,
  options,
  className,
  title,
  disabled,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
  /** Clase del control; sin ella usa el filtro estándar (`admin-filter`). */
  className?: string;
  title?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <select
      className={className ?? "admin-filter"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      title={title}
      disabled={disabled}
      required={required}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function AdminToolbar({ children }: { children: React.ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

export function AdminKpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: AdminTone }) {
  return (
    <div className="admin-kpi" data-tone={tone}>
      <span className="admin-kpi-label">{label}</span>
      <strong className="admin-kpi-value">{value}</strong>
      {note ? <span className="admin-kpi-note">{note}</span> : null}
    </div>
  );
}

export function AdminPanel({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-panel">
      <header className="admin-panel-head">
        <h2 className="admin-panel-title">{title}</h2>
        {meta ? <span className="admin-panel-meta">{meta}</span> : null}
        {action ? <div className="admin-panel-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function AdminTable({
  view,
  label,
  columns,
  children,
}: {
  view: string;
  label: string;
  columns: Array<{ label: string; end?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-table-wrap">
      <div className={`admin-table admin-table--${view}`} role="table" aria-label={label}>
        <div className="admin-table-head" role="row">
          {columns.map((column, index) => (
            <span key={`${index}-${column.label}`} role="columnheader" className={column.end ? "admin-cell admin-cell--end" : "admin-cell"}>
              {column.label}
            </span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export function AdminRow({ children, tone }: { children: React.ReactNode; tone?: AdminTone }) {
  return (
    <div className="admin-table-row" role="row" data-tone={tone}>
      {children}
    </div>
  );
}

export function AdminCell({
  children,
  end,
  title,
  className,
}: {
  children: React.ReactNode;
  end?: boolean;
  title?: string;
  className?: string;
}) {
  const classes = ["admin-cell"];
  if (end) classes.push("admin-cell--end");
  if (className) classes.push(className);
  return (
    <span role="cell" className={classes.join(" ")} title={title}>
      {children}
    </span>
  );
}

/**
 * Pantalla de bloqueo del panel (issue #21). Reemplaza **todo** el shell: no
 * queda contenido del panel detrás, solo el logo, el usuario y el PIN.
 *
 * El PIN nunca se muestra (puntos + `type=password`), se teclea con el teclado
 * en pantalla o el físico y se valida al completar los 6 dígitos o con
 * «Desbloquear» (mínimo 4). Si el servidor revocó la sesión por 5 fallidos, solo
 * queda el botón de login completo. Mobile 390: una sola columna, botones grandes
 * y el foco arranca en el PIN.
 */
export function AdminLockScreen({
  name,
  avatarSrc,
  autoLocked,
  error,
  busy,
  requireLogin,
  onUnlock,
  onFullLogin,
}: {
  name: string;
  avatarSrc?: string | null;
  /** El bloqueo lo disparó la inactividad (cambia el texto del encabezado). */
  autoLocked: boolean;
  error: string;
  busy: boolean;
  /** La sesión quedó invalidada (5 PIN fallidos): solo se sale con login completo. */
  requireLogin: boolean;
  onUnlock: (pin: string) => Promise<void>;
  onFullLogin: () => void;
}) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  // El foco arranca en el PIN y vuelve después de cada intento.
  useEffect(() => {
    if (!requireLogin) inputRef.current?.focus();
  }, [busy, error, requireLogin]);

  async function submitPin(attempt: string) {
    if (submittingRef.current || requireLogin || busy || !pinValid(attempt)) return;
    submittingRef.current = true;
    try {
      await onUnlock(attempt);
    } finally {
      submittingRef.current = false;
      setPin("");
      inputRef.current?.focus();
    }
  }

  function push(digit: string) {
    setPin((current) => pinInput(current + digit));
    inputRef.current?.focus();
  }

  function backspace() {
    setPin((current) => current.slice(0, -1));
    inputRef.current?.focus();
  }

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="admin-lock" role="dialog" aria-modal="true" aria-labelledby="admin-lock-title">
      <section className="admin-lock-card">
        <header className="admin-lock-head">
          <span className="admin-lock-brand">
            <BrandMark className="admin-brand-mark" size={30} />
            <span>
              LEDBOX<span className="admin-brand-dot">.</span>
            </span>
          </span>
          <h1 className="admin-lock-title" id="admin-lock-title">
            Panel bloqueado
          </h1>
          <p className="admin-lock-lede">
            {autoLocked
              ? "Pasó el tiempo de inactividad. Para cuidar tus datos bloqueamos el panel."
              : "Bloqueaste el panel a mano. Para cuidar tus datos lo dejamos cerrado."}
          </p>
        </header>

        <div className="admin-lock-user">
          <AdminAvatar name={name} src={avatarSrc} size={40} />
          <span className="admin-lock-user-text">
            <strong>{name}</strong>
            <small>{requireLogin ? "Sesión invalidada" : "Ingresá tu PIN para volver"}</small>
          </span>
        </div>

        {requireLogin ? (
          <div className="admin-lock-full">
            <AdminNote tone="error" variant="alert">
              {error}
            </AdminNote>
            <AdminButton type="button" variant="primary" icon="logout" onClick={onFullLogin}>
              Iniciar sesión de nuevo
            </AdminButton>
          </div>
        ) : (
          <form
            className="admin-lock-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPin(pin);
            }}
          >
            <PinField
              label="PIN del panel"
              value={pin}
              onChange={setPin}
              length={6}
              autoSubmit
              onComplete={(completed) => void submitPin(completed)}
              inputRef={inputRef}
              error={error || null}
              hint={error ? undefined : "4 a 6 dígitos. Se valida al completarlo o con «Desbloquear»."}
              autoFocus
              disabled={busy}
            />
            <div className="admin-pin-pad" role="group" aria-label="Teclado numérico del PIN">
              {digits.map((digit) => (
                <button
                  key={digit}
                  type="button"
                  className="admin-pin-pad-key"
                  onClick={() => push(digit)}
                  disabled={busy}
                  aria-label={`Dígito ${digit}`}
                >
                  {digit}
                </button>
              ))}
              <span className="admin-pin-pad-key admin-pin-pad-gap" aria-hidden="true" />
              <button
                type="button"
                className="admin-pin-pad-key"
                onClick={() => push("0")}
                disabled={busy}
                aria-label="Dígito 0"
              >
                0
              </button>
              <button
                type="button"
                className="admin-pin-pad-key admin-pin-pad-del"
                onClick={backspace}
                disabled={busy || pin.length === 0}
                aria-label="Borrar el último dígito"
                title="Borrar el último dígito"
              >
                <AdminIcon name="close" size={16} />
              </button>
            </div>
            <AdminButton type="submit" variant="primary" icon="check" busy={busy} disabled={pin.length < PIN_MIN_DIGITS}>
              Desbloquear
            </AdminButton>
          </form>
        )}

        {requireLogin ? null : (
          <button type="button" className="admin-lock-link" onClick={onFullLogin}>
            Cerrar esta sesión e iniciar con otra cuenta
          </button>
        )}
      </section>
    </div>
  );
}

/**
 * Subida de imagen de identidad (issue #22): la usan el avatar de Mi perfil y
 * los dos logos de la sección Empresa. Es la única pieza que abre el selector de
 * archivos del panel; valida por magic bytes y recorta/comprime en el navegador
 * (`prepareIdentityImage`) antes de entregar la imagen lista para subir.
 *
 * La vista previa la dibuja el llamador con el objeto único de identidad
 * (`AdminAvatar` / `AdminOrgLogo`), así el panel no tiene dos formas de mostrar
 * una foto o un logo.
 */
export function AdminImageUpload({
  label,
  hint,
  mode = "avatar",
  preview,
  busy,
  disabled,
  error,
  onPrepared,
  onRemove,
  removeLabel = "Quitar",
}: {
  label: string;
  hint?: string;
  /** `avatar` recorta cuadrado desde el centro; `logo` conserva la relación de aspecto. */
  mode?: "avatar" | "logo";
  preview: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  onPrepared: (image: PreparedIdentityImage) => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState("");
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const message = error || localError;
  const working = Boolean(busy) || preparing;

  async function pick(file: File | null) {
    if (!file) return;
    setLocalError("");
    setPreparing(true);
    const result = await prepareIdentityImage(
      file,
      mode === "logo" ? { square: false, maxSide: 1024 } : { square: true, maxSide: 512 },
    );
    setPreparing(false);
    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    onPrepared(result.image);
  }

  return (
    <div className="admin-field admin-image-field">
      <span className="admin-field-label" id={labelId}>
        {label}
      </span>
      <div className="admin-image-body">
        <span className="admin-image-preview">{preview}</span>
        <div className="admin-image-actions">
          <AdminButton
            type="button"
            icon="upload"
            busy={working}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-describedby={message ? errorId : hint ? hintId : undefined}
          >
            {working ? "Procesando" : "Subir imagen"}
          </AdminButton>
          {onRemove ? (
            <AdminButton
              type="button"
              icon="trash"
              disabled={disabled || working}
              onClick={onRemove}
              title={removeLabel}
              aria-label={removeLabel}
            >
              {removeLabel}
            </AdminButton>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        className="admin-image-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        aria-labelledby={labelId}
        disabled={disabled || working}
        onChange={(event) => {
          void pick(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {message ? (
        <span className="admin-field-error" id={errorId} role="alert">
          {message}
        </span>
      ) : hint ? (
        <span className="admin-field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
