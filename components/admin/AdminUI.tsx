"use client";

import Link from "next/link";
import { Button as SharedButton } from "owncoding-ui";
import type { KpiState } from "@/components/admin/kpi-state";
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { PIN_MAX_DIGITS, PIN_MIN_DIGITS, pinInput, pinValid } from "@/lib/field-rules";
import type { AdminIconName, AdminTimelineEntry, AdminTimelineKind } from "@/lib/admin-types";
import {
  countdownTone,
  formatCountdown,
  formatDateTime,
  formatNumber,
  timelineKindLabel,
  isWhatsappSandbox,
  whatsappHref,
  whatsappReachable,
  type AdminTone,
} from "@/lib/admin-format";
import { adminApiGet } from "@/lib/admin-api";
import { loadImageSource, prepareIdentityImage, type LoadedImage, type PreparedIdentityImage } from "@/lib/identity-image";
import { DEFAULT_IMAGE_FRAMING, boundedImageFraming, identityImageSize, imageFramingRect, initialImageFraming, type ImageFraming } from "@/lib/image-framing";
import { detectIdentityImageMime } from "@/lib/admin-types";
import { BrandMark } from "@/components/brand-mark";
import { AdminIcon } from "./AdminIcons";
import { AdminAvatar } from "./AdminAvatar";
import { NumberField, PinField } from "./AdminFields";
import { WhatsappIcon } from "../whatsapp/WhatsappIcon";
import { SIMULATED_WHATSAPP_NOTICE } from "@/lib/mail-preview";

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

/**
 * Botón único del panel. Variantes: `primary` (acción principal, acento lleno),
 * `secondary` (por defecto, con borde), `ghost` (sin borde: «Cancelar» y acciones
 * terciarias), `danger` (destructiva) y `link` (enlace en línea, sin caja).
 * Tamaños: `md` (por defecto) y `sm` (filas y tarjetas). Con `icon` y sin texto es
 * un botón de solo ícono (pasale `aria-label`/`title`). `busy` muestra el spinner,
 * bloquea el botón y, con `busyLabel`, cambia el texto («Guardando…»).
 */
export type AdminButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type AdminButtonSize = "sm" | "md";

type AdminButtonOwnProps = {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  icon?: AdminIconName;
  /** Ícono al final del texto (flecha de «Ver todos →»). */
  iconEnd?: AdminIconName;
  /** Ícono que no sale del set del panel (p. ej. la marca de WhatsApp); tiene prioridad sobre `icon`. */
  iconNode?: React.ReactNode;
};

type AdminButtonProps = React.ComponentPropsWithRef<"button"> &
  AdminButtonOwnProps & {
    busy?: boolean;
    /** Texto mientras `busy` (por ejemplo «Guardando…»); sin él se conserva el texto. */
    busyLabel?: string;
  };

/** Clases de un botón de la biblioteca (única fuente: el CSS vive en `.admin-btn*`). */
function adminButtonClasses({ variant = "secondary", size = "md", onlyIcon, className }: { variant?: AdminButtonVariant; size?: AdminButtonSize; onlyIcon?: boolean; className?: string }) {
  const classes = ["admin-btn", `admin-btn--${variant}`];
  if (size === "sm") classes.push("admin-btn--sm");
  if (onlyIcon) classes.push("admin-btn--only-icon");
  if (className) classes.push(className);
  return classes.join(" ");
}

export function AdminButton({ variant = "secondary", size = "md", icon, iconEnd, iconNode, busy, busyLabel, children, className, disabled, ...rest }: AdminButtonProps) {
  return (
    <SharedButton
      {...rest}
      type={rest.type ?? "submit"}
      variant={variant === "primary" ? "primary" : "ghost"}
      className={adminButtonClasses({ variant, size, onlyIcon: !children, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <AdminSpinner label="Guardando" /> : iconNode ? iconNode : icon ? <AdminIcon name={icon} /> : null}
      {children ? <span>{busy && busyLabel ? busyLabel : children}</span> : null}
      {iconEnd ? <AdminIcon name={iconEnd} /> : null}
    </SharedButton>
  );
}

/**
 * Enlace con la cara de un botón (navega, no ejecuta): las mismas variantes y
 * tamaños que `AdminButton`. Interno → `next/link`; con `target`, `download` o
 * una URL absoluta, de API o de impresión → `<a>` (con `rel` seguro si abre otra pestaña).
 */
export function AdminButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  iconEnd,
  iconNode,
  className,
  children,
  ...rest
}: AdminButtonOwnProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string }) {
  const classes = adminButtonClasses({ variant, size, onlyIcon: !children, className });
  const content = (
    <>
      {iconNode ? iconNode : icon ? <AdminIcon name={icon} /> : null}
      {children ? <span>{children}</span> : null}
      {iconEnd ? <AdminIcon name={iconEnd} /> : null}
    </>
  );
  const plain = rest.target || rest.download !== undefined || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/api/") || href.startsWith("/imprimir/");
  if (plain) {
    return (
      <a {...rest} className={classes} href={href} rel={rest.target === "_blank" ? (rest.rel ?? "noopener noreferrer") : rest.rel}>
        {content}
      </a>
    );
  }
  return (
    <Link {...rest} className={classes} href={href}>
      {content}
    </Link>
  );
}

/**
 * Botón de solo ícono (cerrar, menú, ayuda, abrir/copiar en una fila). El nombre
 * accesible es obligatorio (`label`) y también es el `title`. Para una acción con
 * texto usá `AdminButton`; para navegar, `AdminIconLink`.
 */
export function AdminIconButton({
  icon,
  iconNode,
  iconSize = 15,
  label,
  className,
  children,
  ...rest
}: React.ComponentPropsWithRef<"button"> & { icon?: AdminIconName; iconNode?: React.ReactNode; iconSize?: number; label: string }) {
  return (
    <button type="button" title={label} {...rest} className={className ? `admin-iconbtn ${className}` : "admin-iconbtn"} aria-label={label}>
      {iconNode ?? (icon ? <AdminIcon name={icon} size={iconSize} /> : null)}
      {children}
    </button>
  );
}

export function AdminIconLink({
  href,
  icon,
  iconNode,
  label,
  external,
  onClick,
}: {
  href: string;
  icon?: AdminIconName;
  /** Ícono que no sale del set del panel (marca de WhatsApp). */
  iconNode?: React.ReactNode;
  label: string;
  external?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      className="admin-iconbtn"
      href={href}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {iconNode ?? (icon ? <AdminIcon name={icon} size={15} /> : null)}
    </a>
  );
}

/** Ítem del menú de acciones de una fila o tarjeta. */
export type AdminMenuItem = {
  label: string;
  icon: AdminIconName;
  /** Acción del ítem; con `href` se dibuja como link. */
  onClick?: () => void;
  href?: string;
  /** Abre el link en una pestaña nueva (imprimibles y portal). */
  external?: boolean;
  disabled?: boolean;
  title?: string;
};

/**
 * Menú de acciones compacto (issue #143): un solo botón «⋯» agrupa las acciones
 * secundarias de la fila/tarjeta. Los accesos frecuentes pueden agruparse
 * en una fila de iconos dentro del panel. El panel flotante se posiciona con `position: fixed` para que no lo
 * recorte el scroll horizontal de las tablas ni de las columnas del tablero; se
 * cierra al elegir, con Escape o con un clic afuera.
 */
export function AdminActionsMenu({
  label,
  items,
  shortcuts = [],
  align = "end",
}: {
  /** Nombre accesible del menú («Acciones del presupuesto X»). */
  label: string;
  items: readonly AdminMenuItem[];
  /** Accesos de uso frecuente en una sola fila, con nombre accesible. */
  shortcuts?: readonly AdminMenuItem[];
  /** Borde al que se ancla el panel; por defecto a la derecha del botón. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const [themeTokens, setThemeTokens] = useState<React.CSSProperties>({});
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panel = popRef.current;
      const width = panel?.offsetWidth || 192;
      const height = panel?.offsetHeight || Math.min(items.length * 44 + 8, window.innerHeight * .7);
      setPos({
        top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)),
        left: Math.max(8, Math.min(align === "start" ? rect.left : rect.right - width, window.innerWidth - width - 8)),
      });
      // The body portal escapes transformed rows; retain the current admin theme.
      const root = buttonRef.current?.closest(".admin-root");
      if (root) {
        const computed = getComputedStyle(root);
        setThemeTokens(Object.fromEntries(Array.from(computed).filter((key) => key.startsWith("--a-") || key.startsWith("--font-")).map((key) => [key, computed.getPropertyValue(key)])) as React.CSSProperties);
      }
    };
    update();
    const frame = requestAnimationFrame(update);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === "Tab") { setOpen(false); buttonRef.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const entries = Array.from(popRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
        if (!entries.length) return;
        event.preventDefault();
        const index = entries.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + entries.length) % entries.length;
        entries[next]?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, align, items.length, shortcuts.length]);

  useEffect(() => {
    if (!open || !pos) return;
    popRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, Boolean(pos)]);

  useEffect(() => {
    if (!open || !pos || !popRef.current) return;
    const panel = popRef.current;
    const clamp = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      setPos({ top: Math.max(8, Math.min(anchor.bottom + 4, innerHeight - panel.offsetHeight - 8)), left: Math.max(8, Math.min(align === "start" ? anchor.left : anchor.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8)) });
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, Boolean(pos), themeTokens, align]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="admin-iconbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}
      >
        <AdminIcon name="dots" size={16} />
      </button>
      {open && pos ? createPortal(
        <div
          id={menuId}
          ref={popRef}
          className="admin-menu-pop"
          role="menu"
          aria-label={label}
          style={{ ...themeTokens, top: pos.top, left: pos.left }}
        >
          {shortcuts.length > 0 ? <div className="admin-menu-shortcuts" role="group" aria-label="Accesos rápidos">
            {shortcuts.map((item) => item.href && !item.disabled ? (
              <Link key={item.label} className="admin-iconbtn" role="menuitem" href={item.href} aria-label={item.label} title={item.title ?? item.label}
                {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                onClick={() => { setOpen(false); buttonRef.current?.focus(); }}>
                <AdminIcon name={item.icon} size={16} />
              </Link>
            ) : (
              <button key={item.label} type="button" className="admin-iconbtn" role="menuitem" aria-label={item.label} title={item.title ?? item.label} disabled={item.disabled}
                onClick={() => { setOpen(false); buttonRef.current?.focus(); item.onClick?.(); }}>
                <AdminIcon name={item.icon} size={16} />
              </button>
            ))}
          </div> : null}
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                className="admin-menu-item"
                href={item.href}
                role="menuitem"
                title={item.title ?? item.label}
                {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                onClick={() => { setOpen(false); buttonRef.current?.focus(); }}
              >
                <AdminIcon name={item.icon} size={14} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                className={`admin-menu-item${item.disabled && item.title && item.title !== item.label ? " admin-menu-item--reason" : ""}`}
                role="menuitem"
                title={item.title ?? item.label}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                  item.onClick?.();
                }}
              >
                <AdminIcon name={item.icon} size={14} />
                {/* Lo deshabilitado explica el motivo a la vista: el `title` no se ve al tocar. */}
                {item.disabled && item.title && item.title !== item.label ? (
                  <span className="admin-menu-text">
                    <span className="admin-menu-label">{item.label}</span>
                    <small className="admin-menu-reason">{item.title}</small>
                  </span>
                ) : (
                  <span>{item.label}</span>
                )}
              </button>
            ),
          )}
        </div>, document.body
      ) : null}
    </>
  );
}

/** Link de WhatsApp con el teléfono normalizado; no se dibuja si no hay número válido. */
export function AdminWhatsappLink({
  phone,
  name,
  message,
}: {
  phone: string | null | undefined;
  name: string;
  /** Mensaje prellenado del chat (issue #36); sin él abre el chat pelado. */
  message?: string | null;
}) {
  const [simulating, setSimulating] = useState(false);
  const href = whatsappHref(phone, message);
  if (!href) {
    // Demo: no se abre wa.me; si hay texto, se muestra cómo se vería el mensaje.
    if (!isWhatsappSandbox() || !whatsappReachable(phone) || !String(message ?? "").trim()) return null;
    const simulatedLabel = `Ver cómo se vería el mensaje de WhatsApp a ${name}`;
    return (
      <>
        <button type="button" className="admin-iconbtn" title={simulatedLabel} aria-label={simulatedLabel} onClick={() => setSimulating(true)}>
          <WhatsappIcon size={15} />
        </button>
        {simulating ? <AdminSimulatedMessageDialog to={name} message={String(message)} onClose={() => setSimulating(false)} /> : null}
      </>
    );
  }
  const label = `Escribir por WhatsApp a ${name}`;
  return (
    <a className="admin-iconbtn" href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}>
      <WhatsappIcon size={15} />
    </a>
  );
}

/**
 * Demo: en una sandbox no se abre WhatsApp. Este diálogo muestra el texto tal como se habría enviado
 * («Así se vería el mensaje»); nada sale hacia afuera.
 */
export function AdminSimulatedMessageDialog({ to, message, onClose }: { to: string; message: string; onClose: () => void }) {
  return (
    <AdminDialog
      title={`${SIMULATED_WHATSAPP_NOTICE} · ${to}`}
      icon="mail"
      size="md"
      description="Demo: no se abre WhatsApp ni sale ningún mensaje."
      onClose={onClose}
      footer={({ requestClose }) => (
        <AdminButton icon="close" type="button" onClick={requestClose}>
          Cerrar
        </AdminButton>
      )}
    >
      <pre className="admin-message-preview">{message}</pre>
    </AdminDialog>
  );
}

/**
 * Acción compacta de WhatsApp con plantilla (issue #35): abre el diálogo de
 * envío con el mensaje prellenado. El llamador la dibuja solo cuando el contacto
 * tiene teléfono (regla existente de WhatsApp).
 */
export function AdminWhatsappTemplateButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" className="admin-iconbtn" title={title} aria-label={title} onClick={onClick}>
      <WhatsappIcon size={15} />
    </button>
  );
}

/**
 * Chip único del panel (estado, etiqueta, contador). Los tonos son los de
 * `AdminTone` y los de `lib/inventory-visual-state.ts` (`ok`, `warn`, `danger`,
 * `info`, `accent`, `neutral`): el color acompaña, nunca es el único canal, así
 * que un estado lleva ícono o texto. `icon` suma el ícono del set del panel,
 * `size="sm"` es la versión compacta (tablero, celdas angostas), `emphasis`
 * resalta el borde y el peso (devolución vencida). `label` da nombre accesible a
 * los chips de solo ícono.
 */
export function AdminBadge({
  tone = "neutral",
  title,
  label,
  icon,
  size = "md",
  emphasis,
  className,
  dataState,
  children,
}: {
  tone?: AdminTone;
  title?: string;
  /** Nombre accesible: obligatorio en los chips de solo ícono. */
  label?: string;
  icon?: AdminIconName;
  size?: "sm" | "md";
  emphasis?: boolean;
  className?: string;
  /** Clave del estado de negocio que dibuja el chip (`data-state`). */
  dataState?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={className ? `admin-badge ${className}` : "admin-badge"}
      data-tone={tone}
      data-size={size === "sm" ? "sm" : undefined}
      data-emphasis={emphasis ? "true" : undefined}
      data-state={dataState}
      title={title}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      {icon ? <AdminIcon name={icon} size={size === "sm" ? 11 : 12} /> : null}
      {children !== undefined && children !== null && children !== false ? <span className="admin-badge-text">{children}</span> : null}
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

export type AdminTabItem = {
  /** Identificador de la pestaña (con `value`/`onChange`); en modo enlace es el `href`. */
  key?: string;
  label: React.ReactNode;
  icon?: AdminIconName;
  /** Contador al lado del nombre; `null`/`undefined` no dibuja nada. */
  count?: number | string | null;
  /** Destino: con `href` la pestaña es un enlace a una ruta real del panel. */
  href?: string;
  /** Pestaña activa cuando es un enlace (con `value` se deduce de `key`). */
  active?: boolean;
  /** Tooltip de la pestaña. */
  title?: string;
};

/**
 * Pestañas únicas del panel. Dos modos con la misma cara:
 * - **Enlaces** (todas las pestañas con `href`): subnavegación entre rutas reales
 *   (Ajustes, Estado, Finanzas); `<nav>` con `aria-current="page"` en la activa.
 * - **Controladas** (`value` + `onChange`): `role="tablist"` con roving tabindex,
 *   flechas, Inicio y Fin; `tabId`/`panelId` enlazan cada pestaña con su panel.
 * - **Filtros** (`filters`): botones `aria-pressed` para filtrar una lista.
 * `compact` achica el alto para barras dentro de una ficha.
 */
export function AdminTabs({
  label,
  items,
  value,
  onChange,
  tabId,
  panelId,
  compact,
  filters,
  className,
}: {
  label: string;
  items: readonly AdminTabItem[];
  value?: string;
  onChange?: (key: string) => void;
  tabId?: (key: string) => string;
  panelId?: (key: string) => string;
  compact?: boolean;
  /** Filtros de una lista (no hay paneles): botones con `aria-pressed` en un `<nav>`, sin `role="tab"`. */
  filters?: boolean;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const keyOf = (item: AdminTabItem) => item.key ?? item.href ?? String(item.label);
  const classes = ["admin-subtabs"];
  if (compact) classes.push("admin-subtabs--compact");
  if (className) classes.push(className);
  const inner = (item: AdminTabItem) => (
    <>
      {item.icon ? <AdminIcon name={item.icon} size={13} /> : null}
      <span className="admin-subtab-label">{item.label}</span>
      {item.count !== undefined && item.count !== null ? <span className="admin-subtab-count">{typeof item.count === "number" ? formatNumber(item.count) : item.count}</span> : null}
    </>
  );
  if (items.length > 0 && items.every((item) => item.href)) {
    return (
      <nav className={classes.join(" ")} aria-label={label}>
        {items.map((item) => {
          const active = item.active ?? (value !== undefined && value === keyOf(item));
          return (
            <Link key={keyOf(item)} className="admin-subtab" href={item.href as string} title={item.title} aria-current={active ? "page" : undefined} data-active={active ? "true" : undefined}>
              {inner(item)}
            </Link>
          );
        })}
      </nav>
    );
  }
  if (filters) {
    return (
      <nav className={classes.join(" ")} aria-label={label}>
        {items.map((item) => {
          const key = keyOf(item);
          const active = value === key;
          return (
            <button key={key} type="button" className="admin-subtab" title={item.title} aria-pressed={active} data-active={active ? "true" : undefined} onClick={() => onChange?.(key)}>
              {inner(item)}
            </button>
          );
        })}
      </nav>
    );
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (!onChange || items.length === 0) return;
    const keys = items.map(keyOf);
    const at = Math.max(0, keys.indexOf(value ?? keys[0]));
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (at + 1) % keys.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (at - 1 + keys.length) % keys.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = keys.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(keys[next]);
    refs.current[keys[next]]?.focus();
  }
  return (
    <div className={classes.join(" ")} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const key = keyOf(item);
        const active = value === key;
        return (
          <button
            key={key}
            ref={(node) => {
              refs.current[key] = node;
            }}
            type="button"
            role="tab"
            id={tabId?.(key)}
            className="admin-subtab"
            title={item.title}
            aria-selected={active}
            aria-controls={panelId?.(key)}
            tabIndex={active ? 0 : -1}
            data-active={active ? "true" : undefined}
            onClick={() => onChange?.(key)}
          >
            {inner(item)}
          </button>
        );
      })}
    </div>
  );
}

/** Aviso inline único del panel: `note` en formularios y bloques, `alert` en las tarjetas de acceso. */
export function AdminNote({
  children,
  tone,
  variant = "note",
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "error";
  variant?: "note" | "alert";
}) {
  if (variant === "alert") {
    return (
      <p
        className={
          tone === "error" ? "admin-alert admin-alert--error" : tone === "warn" ? "admin-alert admin-alert--warn" : "admin-alert admin-alert--success"
        }
        role={tone === "error" ? "alert" : "status"}
      >
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

/**
 * Límite del plan alcanzado (issue #42): el aviso único del 403 explicado que
 * devuelve el servidor, con el acceso directo a la página de Plan para pedir el
 * cambio. Lo dibujan los formularios de alta (usuarios, invitaciones y eventos).
 */
export function AdminPlanLimitNote({ message }: { message: string }) {
  return (
    <p className="admin-note" role="alert" data-tone="error">
      {message} <Link className="admin-note-link" href="/ajustes/plan">Ver planes</Link>
    </p>
  );
}

export function AdminEmpty({
  title,
  hint,
  icon = "info",
  action,
}: {
  title: string;
  hint?: string;
  icon?: AdminIconName;
  action?: React.ReactNode;
}) {
  return (
    <div className="admin-empty">
      <AdminIcon name={icon} size={22} />
      <p className="admin-empty-title">{title}</p>
      {hint ? <p className="admin-empty-hint">{hint}</p> : null}
      {action ? <div className="admin-empty-action">{action}</div> : null}
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
  emptyAction,
  emptyIcon,
  rows,
  children,
}: {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: React.ReactNode;
  /** Ícono del estado vacío; sin él se usa el genérico de `AdminEmpty`. */
  emptyIcon?: AdminIconName;
  rows?: number;
  children: React.ReactNode;
}) {
  if (loading) return <AdminLoadingRows rows={rows} />;
  if (error) return <AdminErrorState message={error} onRetry={onRetry} />;
  if (empty) return <AdminEmpty title={emptyTitle || "Sin registros"} hint={emptyHint} action={emptyAction} icon={emptyIcon} />;
  return <>{children}</>;
}


/**
 * Sección plegable de los formularios («Más datos», issues #88 y #106): deja
 * lo secundario detrás de un toque sin perder nada — el contenido **no** se
 * desmonta (los campos conservan lo cargado) y solo se oculta con `hidden`, así
 * tampoco recibe foco. Un solo objeto para el alta de clientes y de eventos.
 */
export function AdminDisclosure({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Aclaración de lo que hay adentro («empresa, RUC, encargado y links»). */
  hint?: string;
  /** Abierto al editar (los datos existentes se ven de entrada). */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Si pasa a ser necesaria (p. ej. elegir «a plazo»), se abre sin remontar el contenido.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  // Un error adentro nunca queda escondido: si un campo plegado queda inválido, se abre.
  useEffect(() => {
    if (!open && bodyRef.current?.querySelector('[aria-invalid="true"]')) setOpen(true);
  });
  return (
    <div className="admin-disclosure" data-open={open ? "true" : undefined} onInvalidCapture={() => setOpen(true)}>
      <button
        type="button"
        className="admin-disclosure-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <AdminIcon name="chevron-down" size={14} />
        <span>{title}</span>
        {hint ? <small>{hint}</small> : null}
      </button>
      <div className="admin-disclosure-body" id={bodyId} hidden={!open} ref={bodyRef}>
        {children}
      </div>
    </div>
  );
}

/**
 * Diálogo único del panel: overlay a pantalla completa y hoja centrada.
 * Contrato: rol dialog con `aria-modal`, foco al abrir (respeta un campo con
 * `autoFocus`), trampa de foco con Tab, cierre con Escape y clic afuera, y el
 * foco vuelve al disparador al cerrar. `wide` para las tablas chicas y `ficha`
 * para la ficha 360 del cliente (issue #34): panel lateral a pantalla completa
 * de alto. En celular los formularios se ajustan a su contenido y la ficha
 * conserva la hoja completa.
 *
 * - `description`: una línea bajo el título que dice qué pasa al guardar.
 * - `footer`: pie fijo, siempre visible, con la acción principal a la derecha.
 *   Los diálogos que arman su pie con `.admin-dialog-foot` dentro de los hijos
 *   conservan su contrato: el estilo del pie fijo se les aplica igual.
 * - `footer` también acepta una función `({ requestClose })`: «Cancelar» debe usar
 *   `requestClose` para pasar por la misma confirmación que la X y Esc.
 * - `dirty`: con cambios sin guardar, cerrar (X, Esc o clic afuera) pide
 *   confirmación dentro del mismo diálogo.
 * - `size`: `sm` (440 px), `md` (560 px, por defecto), `lg` (720 px) y `xl`
 *   (960 px, grilla de tres columnas); `default` y `wide` siguen valiendo como
 *   alias de `md` y `lg`. `ficha` es el panel lateral.
 * - `error` / `warning`: franja entre el cuerpo y el pie (siempre visible, no
 *   se pierde al desplazar el formulario).
 * - Celular (0-767 px): formularios con altura natural y máximo según
 *   `visualViewport`; fichas de alto completo. Safe-area arriba y abajo; el
 *   cuerpo largo se desplaza y el pie queda encima del teclado.
 */
export function AdminDialog({
  title,
  onClose,
  size = "md",
  icon,
  description,
  footer,
  error,
  warning,
  dirty = false,
  children,
}: {
  title: string;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "default" | "wide" | "ficha";
  /** Ícono del asunto del diálogo; va en un cuadro con acento suave. */
  icon?: AdminIconName;
  /** Subtítulo de una línea: qué pasa al guardar. */
  description?: string;
  /** Pie fijo del diálogo (acción principal a la derecha). */
  footer?: React.ReactNode | ((api: { requestClose: () => void }) => React.ReactNode);
  /** Error de la última acción: va arriba del pie, fuera del scroll del cuerpo (texto o nodo, p. ej. con un link). */
  error?: React.ReactNode;
  /** Aviso no bloqueante (por ejemplo, un precio fuera de regla), arriba del pie. */
  warning?: string | null;
  /** Hay cambios sin guardar: cerrar pide confirmación. */
  dirty?: boolean;
  children: React.ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // El diálogo se monta dentro de `.admin-root` (tokens y tema) pero fuera del
  // diálogo que lo abrió: un `fixed` dentro de un padre con `backdrop-filter`
  // se recortaba a la hoja de abajo (por ejemplo, «Nuevo cliente» desde «Precio y condiciones»).
  const [host, setHost] = useState<HTMLElement | "inline" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [confirming, setConfirming] = useState(false);
  // Siempre el último estado, sin re-suscribir el teclado en cada render.
  const latest = useRef({ onClose, dirty, confirming });
  latest.current = { onClose, dirty, confirming };

  const requestClose = useCallback(() => {
    const current = latest.current;
    if (current.dirty) setConfirming(true);
    else current.onClose();
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHost(anchorRef.current?.closest<HTMLElement>(".admin-root") ?? "inline");
  }, []);

  const ready = host !== null;
  useEffect(() => {
    if (!ready) return;
    const token = Symbol("dialog");
    DIALOG_STACK.push(token);
    const opener = openerRef.current;
    // Si un campo del diálogo ya tomó el foco al montar (`autoFocus`), se
    // respeta: el botón de cerrar es solo el respaldo (issue #106).
    const active = document.activeElement;
    const ownsFocus = active instanceof HTMLElement && Boolean(active.closest(".admin-dialog"));
    if (!ownsFocus) closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      // Con diálogos apilados, Escape y Tab son del que está arriba.
      if (DIALOG_STACK[DIALOG_STACK.length - 1] !== token) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        if (latest.current.confirming) setConfirming(false);
        else requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = sectionRef.current;
      if (!root) return;
      const current = document.activeElement;
      if (current instanceof HTMLElement && document.body.contains(current) && !root.contains(current) && current !== document.body) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === current);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = DIALOG_STACK.indexOf(token);
      if (at >= 0) DIALOG_STACK.splice(at, 1);
      if (opener && document.body.contains(opener)) opener.focus();
    };
  }, [requestClose, ready]);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  // Teclado en pantalla (celular): la hoja toma el alto visible de `visualViewport`
  // para que el pie quede pegado encima del teclado. En escritorio no hace nada
  // (el CSS solo usa la variable dentro del breakpoint de la hoja).
  useEffect(() => {
    if (!ready) return;
    const viewport = window.visualViewport;
    const overlay = sectionRef.current?.parentElement;
    if (!viewport || !overlay) return;
    function sync() {
      if (!viewport || !overlay) return;
      overlay.style.setProperty("--admin-dialog-vh", `${Math.round(viewport.height)}px`);
      overlay.style.setProperty("--admin-dialog-vtop", `${Math.round(viewport.offsetTop)}px`);
    }
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, [ready]);

  const classes = ["admin-dialog", "admin-dialog--sheet"];
  if (size === "sm") classes.push("admin-dialog--sm");
  if (size === "lg" || size === "wide") classes.push("admin-dialog--lg", "admin-dialog--wide");
  if (size === "xl") classes.push("admin-dialog--xl");
  if (size === "ficha") classes.push("admin-dialog--ficha");
  const content = (
    <div
      className={size === "ficha" ? "admin-dialog-overlay admin-dialog-overlay--ficha" : "admin-dialog-overlay"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={sectionRef}
        className={classes.join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="admin-dialog-head">
          {icon ? (
            <span className="admin-dialog-icon" aria-hidden="true">
              <AdminIcon name={icon} size={18} />
            </span>
          ) : null}
          <div className="admin-dialog-heading">
            <h2 className="admin-dialog-title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="admin-dialog-description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button ref={closeRef} type="button" className="admin-iconbtn admin-dialog-close" onClick={requestClose} aria-label="Cerrar" title="Cerrar">
            <AdminIcon name="close" size={15} />
          </button>
        </header>
        <div className="admin-dialog-body">{children}</div>
        {!confirming && (error || warning) ? (
          <div className="admin-dialog-status">
            {error ? (typeof error === "string" ? <AdminNote tone="error">{error}</AdminNote> : error) : <AdminNote tone="warn">{warning}</AdminNote>}
          </div>
        ) : null}
        {confirming ? (
          <div className="admin-dialog-confirm" role="alert">
            <div className="admin-dialog-confirm-text">
              <strong>¿Descartar los cambios?</strong>
              <span>Lo que cargaste todavía no se guardó.</span>
            </div>
            <div className="admin-dialog-actions">
              <AdminButton ref={keepRef} type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Seguir editando
              </AdminButton>
              <AdminButton type="button" variant="danger" onClick={() => latest.current.onClose()}>
                Descartar
              </AdminButton>
            </div>
          </div>
        ) : footer ? (
          <footer className="admin-dialog-footer">{typeof footer === "function" ? footer({ requestClose }) : footer}</footer>
        ) : null}
      </section>
    </div>
  );
  return (
    <>
      <span ref={anchorRef} hidden />
      {host === null ? null : host === "inline" ? content : createPortal(content, host)}
    </>
  );
}

/** Pila de diálogos abiertos: el teclado es del último. */
const DIALOG_STACK: symbol[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Sección de un diálogo: título chico en mayúsculas con un separador sutil y una
 * grilla de 12 columnas. Cada campo ocupa las columnas de su `size` (xs 3, sm 4,
 * md 6, lg 8, full 12); con `columns` (1 a 4 campos por fila) todos miden lo mismo.
 * En celular siempre es una columna. `AdminCol` da un ancho propio a un campo suelto.
 * `collapsible` la pliega bajo su título («Más opciones»): lo avanzado no
 * estorba, pero abierto de entrada (`defaultOpen`) cuando ya tiene datos.
 */
export function AdminDialogSection({
  title,
  id,
  stack,
  collapsible,
  defaultOpen,
  hint,
  columns,
  children,
}: {
  title?: string;
  /** Ancla de la sección (navegación dentro de una ficha). */
  id?: string;
  /** Campos por fila en escritorio (1 a 4): pisa el ancho por tipo de cada campo. */
  columns?: 1 | 2 | 3 | 4;
  /** Contenido en una sola columna de bloques (fichas) en lugar de la grilla de dos columnas de los formularios. */
  stack?: boolean;
  /** Sección plegable (requiere `title`); por defecto cerrada. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Aclaración del título plegable («foto, tiempos y notas»). */
  hint?: string;
  children: React.ReactNode;
}) {
  const grid = <div className={stack ? "admin-dialog-stack" : "admin-dialog-grid"} data-columns={stack ? undefined : columns}>{children}</div>;
  if (collapsible && title) {
    return (
      <section className="admin-dialog-section admin-dialog-section--collapsible" id={id}>
        <AdminDisclosure title={title} hint={hint} defaultOpen={defaultOpen}>
          {grid}
        </AdminDisclosure>
      </section>
    );
  }
  return (
    <section className="admin-dialog-section" id={id}>
      {title ? <h3 className="admin-dialog-section-title">{title}</h3> : null}
      {grid}
    </section>
  );
}

/**
 * Ancho propio dentro de la grilla de 12 columnas de un diálogo: `span` en
 * doceavos (3 = un cuarto, 4 = un tercio, 6 = la mitad, 8, 12 = todo el ancho).
 * En celular ocupa siempre el ancho completo.
 */
export function AdminCol({ span = 6, children }: { span?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12; children: React.ReactNode }) {
  return (
    <div className="admin-col" data-span={span}>
      {children}
    </div>
  );
}

/**
 * Confirmación propia de una acción destructiva o irreversible (nunca el
 * cuadro nativo del navegador): diálogo chico con Cancelar y la acción a la derecha.
 */
export function AdminConfirmDialog({
  title,
  message,
  confirmLabel,
  busyLabel = "Procesando…",
  icon = "alert",
  danger = false,
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  icon?: AdminIconName;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AdminDialog
      title={title}
      icon={icon}
      size="sm"
      error={error}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton
            type="button"
            variant={danger ? "ghost" : "primary"}
            className={danger ? "admin-btn--danger" : undefined}
            icon="check"
            busy={busy}
            busyLabel={busyLabel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AdminButton>
        </>
      )}
    >
      <p className="admin-dialog-text">{message}</p>
    </AdminDialog>
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
      emptyIcon="clock"
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
/** Cronología real que se pide sola: la usa el diálogo y la pestaña Historial de la ficha del evento. */
export function AdminTimelineLoader({ path }: { path: string }) {
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
    <AdminTimeline
      entries={entries ?? []}
      loading={entries === null && !error}
      error={error}
      onRetry={() => setAttempt((current) => current + 1)}
      emptyTitle="Todavía no hay hitos registrados"
      emptyHint="Los hitos aparecen solos cuando el presupuesto o el evento tienen movimientos reales."
    />
  );
}

export function AdminTimelineDialog({ title, path, onClose }: { title: string; path: string; onClose: () => void }) {
  return (
    <AdminDialog title={title} size="wide" icon="clock" onClose={onClose}>
      <AdminTimelineLoader path={path} />
      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton icon="close" onClick={onClose}>Cerrar</AdminButton>
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
  tone,
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
  /** Tono del estado que muestra el control (issue #75): pinta el select. */
  tone?: AdminTone;
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
      data-tone={tone}
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

/** Contexto corto de página: mantiene breadcrumb y ayuda visibles sin repetir el título del topbar. */
export function AdminModuleContext({
  breadcrumb,
  hint,
  meta,
  action,
}: {
  breadcrumb: string;
  hint: string;
  meta?: string;
  /** Acción principal del módulo (por ejemplo «Nuevo presupuesto»), a la derecha. */
  action?: React.ReactNode;
}) {
  return (
    <div className="admin-module-context">
      <div className="admin-module-context-copy">
        <p className="admin-module-context-trail">
          EventOS <span aria-hidden="true">/</span> <strong>{breadcrumb}</strong>
        </p>
        <p className="admin-module-context-hint">{hint}</p>
      </div>
      {meta ? <span className="admin-module-context-meta">{meta}</span> : null}
      {action ? <div className="admin-module-context-action">{action}</div> : null}
    </div>
  );
}

const AdminKpiStateContext = createContext<KpiState>("ready");

/**
 * Grilla de indicadores. Con `state="loading"` todos los AdminKpi hijos muestran
 * un esqueleto en lugar de un «0» inventado; con `state="error"` (falló y no hay
 * datos) muestran «—». Un 0 ya cargado se sigue mostrando como 0.
 */
export function AdminKpis({
  state = "ready",
  className,
  label,
  children,
}: {
  state?: KpiState;
  className?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <AdminKpiStateContext.Provider value={state}>
      <section className={className ? `admin-kpis ${className}` : "admin-kpis"} aria-label={label} aria-busy={state === "loading"}>
        {state === "loading" ? <span className="sr-only" role="status">Cargando indicadores</span> : null}
        {children}
      </section>
    </AdminKpiStateContext.Provider>
  );
}

export function AdminKpi({
  label,
  value,
  note,
  tone,
  icon,
  loading,
  state,
  onSelect,
  active,
  actionLabel,
}: {
  label: string;
  /** Con `onSelect` el indicador es un botón-filtro (`active` = filtro vigente). */
  onSelect?: () => void;
  active?: boolean;
  /** `undefined`/`null` = todavía sin dato: se muestra el esqueleto, nunca un 0. */
  value: string | null | undefined;
  note?: string;
  tone?: AdminTone;
  icon?: AdminIconName;
  /** Explícito: `false` pisa el estado del grupo; `true` fuerza el esqueleto. */
  loading?: boolean;
  /** Estado propio (grillas con varios recursos: cada KPI espera el suyo). */
  state?: KpiState;
  /** Nombre accesible del botón-filtro («Filtrar por próximos 7 días»); por defecto, el rótulo + valor. */
  actionLabel?: string;
}) {
  const groupState = useContext(AdminKpiStateContext);
  const effective: KpiState = loading === true ? "loading" : loading === false ? "ready" : state ?? groupState;
  const current: KpiState = effective === "ready" && value == null ? "loading" : effective;
  const shown = current === "ready";
  const Wrapper = onSelect ? "button" : "div";
  return (
    <Wrapper
      className={onSelect ? "admin-kpi admin-kpi--filter" : "admin-kpi"}
      {...(onSelect
        ? {
            type: "button" as const,
            onClick: onSelect,
            "aria-pressed": Boolean(active),
            "aria-label": actionLabel ? `${actionLabel}${shown && value != null ? `: ${value}` : ""}` : undefined,
            "data-active": active ? "true" : undefined,
          }
        : {})}
      data-tone={shown ? tone : undefined}
      data-loading={current === "loading" ? "true" : undefined}
      data-state={current}
    >
      <span className="admin-kpi-label">
        {icon ? (
          <span className="admin-kpi-icon" aria-hidden="true">
            <AdminIcon name={icon} size={12} />
          </span>
        ) : null}
        {/* El texto va en su propio nodo para poder truncarlo sin perder el ícono. */}
        <span className="admin-kpi-label-text" title={label}>{label}</span>
      </span>
      {current === "loading" ? (
        <strong className="admin-kpi-value admin-kpi-value--loading">
          <span className="admin-kpi-skeleton" aria-hidden="true" />
        </strong>
      ) : current === "error" ? (
        <strong className="admin-kpi-value" title="No pudimos cargar este dato">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Sin dato: no pudimos cargarlo</span>
        </strong>
      ) : (
        /* El `title` deja leer completo lo que el compacto trunca (issue #113). */
        <strong className="admin-kpi-value" title={value ?? undefined}>{value}</strong>
      )}
      {note && shown ? <span className="admin-kpi-note" title={note}>{note}</span> : null}
    </Wrapper>
  );
}

export function AdminPanel({
  title,
  meta,
  action,
  icon,
  children,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
  /** Ícono del tipo de sección; coherente entre módulos (cobros = mismo ícono siempre). */
  icon?: AdminIconName;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-panel">
      <header className="admin-panel-head">
        {icon ? (
          <span className="admin-panel-icon" aria-hidden="true">
            <AdminIcon name={icon} size={13} />
          </span>
        ) : null}
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
    <div className="admin-table-wrap" role="region" aria-label={`${label} · tabla`} tabIndex={0}>
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

/**
 * Fila de tabla. Con `onActivate` toda la fila es un blanco de clic (cursor y resalte): el clic sobre un
 * control propio (botón, enlace, casilla, menú) no la activa. El acceso con teclado lo da el control
 * principal de la fila (por ej. el botón del nombre), no la fila.
 */
export function AdminRow({
  children,
  tone,
  onActivate,
  selected,
}: {
  children: React.ReactNode;
  tone?: AdminTone;
  onActivate?: (event: React.MouseEvent<HTMLDivElement>) => void;
  selected?: boolean;
}) {
  return (
    <div
      className="admin-table-row"
      role="row"
      data-tone={tone}
      data-clickable={onActivate ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      aria-selected={selected || undefined}
      onClick={
        onActivate
          ? (event) => {
              if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label, [role='menu'], [role='menuitem'], [data-oc-control]")) return;
              onActivate(event);
            }
          : undefined
      }
    >
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
  pinDigits,
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
  /** Largo del PIN aprendido en este navegador (issue #54); `null` si no se sabe. */
  pinDigits?: number | null;
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
              length={PIN_MAX_DIGITS}
              autoSubmit
              expectedLength={pinDigits ?? null}
              onComplete={(completed) => void submitPin(completed)}
              inputRef={inputRef}
              error={error || null}
              hint={error ? undefined : "4 a 6 dígitos: se valida solo al completarlo."}
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
 * Entrada de archivos de texto del panel (issue #40): la usa la importación del
 * extracto bancario para leer un CSV local. El texto no se sube a ningún lado:
 * se queda en el navegador y viaja al API recién al previsualizar o importar.
 * Es la única pieza del panel que abre un archivo de texto; los adjuntos de
 * imagen/PDF siguen en `AdminImageUpload`.
 */
export function AdminCsvField({
  label,
  hint,
  fileName,
  busy,
  disabled,
  error,
  onText,
}: {
  label: string;
  hint?: string;
  /** Nombre del archivo ya leído (el llamador lo conserva para la cabecera). */
  fileName?: string | null;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  /** Texto completo del archivo y su nombre, listos para la vista previa. */
  onText: (text: string, fileName: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localError, setLocalError] = useState("");
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const message = error || localError;

  async function pick(file: File | null) {
    if (!file) return;
    setLocalError("");
    if (file.size > MAX_CSV_FILE_BYTES) {
      setLocalError("El archivo supera los 512 KB: dividí el extracto por período.");
      return;
    }
    const text = await file.text().catch(() => "");
    if (!text.trim()) {
      setLocalError("El archivo está vacío o no es un CSV de texto.");
      return;
    }
    onText(text, file.name);
  }

  return (
    <div className="admin-field admin-csv-field">
      <span className="admin-field-label" id={labelId}>
        {label}
      </span>
      <div className="admin-csv-body">
        <span className="admin-csv-name" title={fileName ?? undefined}>
          {fileName || "Ningún archivo elegido"}
        </span>
        <AdminButton
          type="button"
          icon="upload"
          busy={busy}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-describedby={message ? errorId : hint ? hintId : undefined}
        >
          Elegir CSV
        </AdminButton>
      </div>
      <input
        ref={inputRef}
        className="admin-csv-input"
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain"
        aria-labelledby={labelId}
        disabled={disabled || busy}
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

/** Tope del archivo de texto aceptado por `AdminCsvField` (512 KB, igual que el API). */
const MAX_CSV_FILE_BYTES = 512 * 1024;

/**
 * Subida de imagen de identidad (issue #22): la usan el avatar de Mi perfil y
 * los dos logos de la sección Empresa. Es la única pieza que abre el selector de
 * archivos de identidad del panel; valida por magic bytes y recorta/comprime en
 * el navegador (`prepareIdentityImage`) antes de entregar la imagen lista para
 * subir.
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
  editSrc,
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
  /** Imagen actual controlada por el consumidor; se vuelve a editar sólo al pedirlo. */
  editSrc?: string | null;
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

  const [editing, setEditing] = useState<File | null>(null);
  function pick(file: File | null) {
    if (!file || working || disabled) return;
    setLocalError("");
    setEditing(file);
  }
  async function editCurrent() {
    if (!editSrc || working || disabled) return;
    setLocalError(""); setPreparing(true);
    try {
      const source = new URL(editSrc, window.location.href);
      const localData = /^data:image\/(?:jpeg|png|webp);base64,/i.test(editSrc);
      if (!localData && (source.origin !== window.location.origin || !["http:", "https:"].includes(source.protocol))) throw new Error("No se puede editar esta imagen desde una dirección externa. Subí el archivo original.");
      const response = await fetch(editSrc, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("No pudimos abrir la imagen actual. Probá de nuevo o subí el original.");
      const blob = await response.blob();
      setEditing(new File([blob], "imagen-actual", { type: blob.type }));
    } catch (failure) { setLocalError(failure instanceof Error ? failure.message : "No pudimos abrir la imagen actual."); }
    finally { setPreparing(false); }
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
          {editSrc ? <AdminButton type="button" icon="edit" disabled={disabled || working} onClick={() => void editCurrent()}>Editar encuadre</AdminButton> : null}
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
      {editing ? <AdminIdentityImageEditor file={editing} mode={mode} onCancel={() => setEditing(null)} onApply={(image) => { setEditing(null); onPrepared(image); }} /> : null}
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

/** Encuadre único de avatar y logos: el mismo rectángulo dibuja preview y exportación. */
export function AdminIdentityImageEditor({ file, mode, onApply, onCancel }: {
  file: File; mode: "avatar" | "logo"; onApply: (image: PreparedIdentityImage) => void; onCancel: () => void;
}) {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [framing, setFraming] = useState<ImageFraming>({ ...DEFAULT_IMAGE_FRAMING });
  const [initial, setInitial] = useState<ImageFraming>({ ...DEFAULT_IMAGE_FRAMING });
  const [zoomInput, setZoomInput] = useState("100");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const helpId = useId();
  const drag = useRef<{ pointerId: number; x: number; y: number; framing: ImageFraming } | null>(null);
  const square = mode === "avatar", maxSide = square ? 512 : 1024;
  const size = loaded ? identityImageSize(loaded.width, loaded.height, square, maxSide) : { width: 1, height: 1 };
  useEffect(() => {
    let active = true;
    let resource: LoadedImage | null = null;
    const read = async () => {
      try {
        if (!file.size || !detectIdentityImageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) throw new Error("Elegí un JPG, PNG o WebP real. El archivo no puede estar vacío.");
        resource = await loadImageSource(file);
        if (!resource || resource.width < 1 || resource.height < 1) throw new Error("No pudimos leer esta imagen; probá con otro archivo.");
        if (!active) { resource.release(); resource = null; return; }
        const frame = initialImageFraming(resource.width, resource.height, square);
        setLoaded(resource); setFraming(frame); setInitial(frame);
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "No pudimos leer la imagen."); }
      finally { if (active) setLoading(false); }
    };
    void read();
    return () => { active = false; resource?.release(); resource = null; };
  }, [file, square]);
  useEffect(() => {
    if (!loaded || !canvasRef.current) return;
    const context = canvasRef.current.getContext("2d");
    if (!context) { setError("El navegador no permite preparar la imagen."); return; }
    context.clearRect(0, 0, size.width, size.height);
    const rect = imageFramingRect(loaded.width, loaded.height, size.width, size.height, framing);
    context.drawImage(loaded.image, rect.x, rect.y, rect.width, rect.height);
  }, [loaded, framing, size.width, size.height]);
  useEffect(() => { setZoomInput(String(Math.round(framing.zoom * 100))); }, [framing.zoom]);
  function update(patch: Partial<ImageFraming>) { setFraming((current) => boundedImageFraming({ ...current, ...patch })); }
  async function apply() {
    if (!loaded || applying || loading) return;
    setApplying(true); setError("");
    try {
      const result = await prepareIdentityImage(file, { square, maxSide, framing });
      if (!result.ok) { setError(result.error); return; }
      onApply(result.image);
    } catch { setError("No pudimos preparar la imagen. Probá otra vez."); }
    finally { setApplying(false); }
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!loaded || !drag.current || event.pointerId !== drag.current.pointerId || applying) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rect = imageFramingRect(loaded.width, loaded.height, size.width, size.height, drag.current.framing);
    update({ x: drag.current.framing.x + (rect.travelX ? (event.clientX - drag.current.x) * size.width / bounds.width / rect.travelX : 0), y: drag.current.framing.y + (rect.travelY ? (event.clientY - drag.current.y) * size.height / bounds.height / rect.travelY : 0) });
  }
  return <AdminDialog title={square ? "Encuadrar foto de perfil" : "Encuadrar logo"} size="md" icon="image" error={error}
    description="Arrastrá la imagen o ajustá los controles. Recién se usa cuando pulsás Aplicar."
    dirty={JSON.stringify(framing) !== JSON.stringify(initial)} onClose={() => { if (!applying) onCancel(); }}
    footer={({ requestClose }) => <><AdminButton icon="close" onClick={requestClose} disabled={applying}>Cancelar</AdminButton><AdminButton variant="primary" icon="check" onClick={() => void apply()} disabled={!loaded || loading} busy={applying} busyLabel="Preparando…">Aplicar</AdminButton></>}>
    {loading ? <AdminLoadingRows rows={2} /> : loaded ? <div className="admin-image-editor">
      <div className="admin-image-editor-stage" data-mode={mode}>
        <canvas ref={canvasRef} width={size.width} height={size.height} tabIndex={0} aria-label="Vista previa del encuadre. Usá las flechas para mover y más o menos para acercar." aria-describedby={helpId}
          onPointerDown={(event) => { if (applying) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, framing }; }} onPointerMove={move}
          onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(event) => { if (applying) return; const step = event.shiftKey ? .2 : .05; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) { event.preventDefault(); if (event.key === "ArrowLeft") update({ x: framing.x - step }); else if (event.key === "ArrowRight") update({ x: framing.x + step }); else if (event.key === "ArrowUp") update({ y: framing.y - step }); else if (event.key === "ArrowDown") update({ y: framing.y + step }); else update({ zoom: framing.zoom + (event.key === "-" ? -.25 : .25) }); } }} />
      </div>
      <p className="admin-field-hint" id={helpId}>Arrastrá para mover. Con teclado: flechas para posición, + y − para zoom. El fondo cuadriculado indica transparencia.</p>
      <div className="admin-image-editor-presets">
        <AdminButton icon="image" onClick={() => setFraming({ ...DEFAULT_IMAGE_FRAMING })} disabled={applying}>Ajustar completa</AdminButton>
        {square ? <AdminButton icon="user" onClick={() => setFraming(initialImageFraming(loaded.width, loaded.height, true))} disabled={applying}>Rellenar centrado</AdminButton> : null}
        <AdminButton icon="refresh" onClick={() => setFraming(initial)} disabled={applying}>Reiniciar</AdminButton>
      </div>
      <div className="admin-image-editor-controls">
        <div className="admin-image-editor-zoom" onBlur={() => setZoomInput(String(Math.round(framing.zoom * 100)))}><AdminButton title="Alejar imagen" aria-label="Alejar imagen" onClick={() => update({ zoom: framing.zoom - .25 })} disabled={applying || framing.zoom <= 1}>−</AdminButton><NumberField label="Zoom" suffix="%" value={zoomInput} onChange={(value) => { setZoomInput(value); const zoom = Number(value); if (value && zoom >= 100 && zoom <= 800) update({ zoom: zoom / 100 }); }} hint="100–800 %" error={zoomInput && (Number(zoomInput) < 100 || Number(zoomInput) > 800) ? "Usá entre 100 y 800 %." : null} disabled={applying} /><AdminButton icon="plus" title="Acercar imagen" aria-label="Acercar imagen" onClick={() => update({ zoom: framing.zoom + .25 })} disabled={applying || framing.zoom >= 8} /></div>
        <NumberField label="Posición horizontal" suffix="%" value={String(Math.round((framing.x + 1) * 50))} onChange={(value) => update({ x: Number(value) / 50 - 1 })} disabled={applying} hint="0 izquierda · 50 centro · 100 derecha" size="md" />
        <NumberField label="Posición vertical" suffix="%" value={String(Math.round((framing.y + 1) * 50))} onChange={(value) => update({ y: Number(value) / 50 - 1 })} disabled={applying} hint="0 arriba · 50 centro · 100 abajo" size="md" />
      </div>
    </div> : null}
  </AdminDialog>;
}
