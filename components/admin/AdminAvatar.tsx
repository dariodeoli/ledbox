"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/admin-format";
import { ADMIN_ROOT_ID } from "@/lib/admin-theme";
import type { LogoVariant } from "@/lib/admin-types";

/**
 * Objeto único de identidad (issue #22): el avatar de persona y el logo de la
 * empresa **son el mismo componente**. Ninguna pantalla dibuja un `<img>` a mano.
 *
 * Orden del avatar de persona: foto subida (`src`, servida con sesión) → foto
 * permitida que pase el llamador (la `photoUrl` de una promotora, con
 * `referrerPolicy="no-referrer"`) → iniciales. Si la imagen falla, cae a las
 * iniciales: nunca queda un cuadro roto.
 *
 * El logo de empresa elige la variante por tema en **un solo lugar**: fondo
 * oscuro → `light`; fondo claro → `dark`. En papel siempre va la clara (la hoja
 * imprimible no usa este componente, pasa la URL clara a `PrintHeader`).
 */

export type IdentityImageSize = 22 | 28 | 32 | 40 | 64 | 96;

/** Tema activo del panel, leído del `data-theme` del root (lo cambia el toggle). */
function useAdminTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = document.getElementById(ADMIN_ROOT_ID);
    if (!root) return;
    const read = () => setTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/** Variante del logo que corresponde al fondo: oscuro → claro, y al revés. */
export function logoVariantForTheme(theme: "dark" | "light"): LogoVariant {
  return theme === "dark" ? "light" : "dark";
}

function IdentityFrame({
  src,
  fallback,
  size,
  photo,
  className,
  title,
}: {
  src: string | null | undefined;
  fallback: string;
  size: number;
  /** Foto de persona (recorte circular, `cover`) o logo (rectángulo redondeado, `contain`). */
  photo: boolean;
  className?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Una URL nueva (otra persona u otra versión) vuelve a intentar la imagen.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const classes = ["admin-avatar"];
  if (photo) classes.push("admin-avatar--photo");
  else classes.push("admin-avatar--logo");
  if (className) classes.push(className);
  const box = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) };

  return (
    <span className={classes.join(" ")} style={box} title={title} aria-hidden="true">
      {src && !failed ? (
        <img
          className="admin-avatar-img"
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="admin-avatar-text">{fallback}</span>
      )}
    </span>
  );
}

/** Avatar de persona: foto subida o permitida → iniciales del nombre. */
export function AdminAvatar({
  name,
  src,
  size = 28,
  className,
  title,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: IdentityImageSize;
  className?: string;
  title?: string;
}) {
  return <IdentityFrame src={src} fallback={initials(name)} size={size} photo className={className} title={title} />;
}

/** Logo de la empresa: variante clara/oscura según el tema → monograma `LB`. */
export function AdminOrgLogo({
  name,
  lightSrc,
  darkSrc,
  size = 28,
  className,
  title,
  variant,
}: {
  name: string | null | undefined;
  lightSrc?: string | null;
  darkSrc?: string | null;
  size?: IdentityImageSize;
  className?: string;
  title?: string;
  /** Fuerza una variante (la usa la vista previa de la sección Empresa). */
  variant?: LogoVariant;
}) {
  const themeVariant = logoVariantForTheme(useAdminTheme());
  const chosen = variant ?? themeVariant;
  const source = chosen === "light" ? lightSrc : darkSrc;
  return <IdentityFrame src={source} fallback="LB" size={size} photo={false} className={className} title={title ?? name ?? "Empresa"} />;
}
