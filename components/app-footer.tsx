import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * Pie de página único (issue #37): la misma fuente para todas las superficies.
 *
 * - `app` (panel, demo, portal): © 2026 EventOS · … · vX.Y.Z · Desarrollado por Owncoding.
 * - `company` (sitio y landing de LedBox): © 2026 LedBox · EventOS vX.Y.Z · …
 *
 * La versión sale de `lib/version.ts` (fuente única: `package.json`).
 */
export function AppFooter({ variant = "app", className }: { variant?: "app" | "company"; className?: string }) {
  const classes = ["app-footer", `app-footer--${variant}`, className].filter(Boolean).join(" ");
  return (
    <footer className={classes}>
      <span className="app-footer-text">
        {variant === "company" ? (
          <>
            © 2026 LedBox · EventOS {APP_VERSION_LABEL} · Todos los derechos reservados
          </>
        ) : (
          <>© 2026 EventOS · Todos los derechos reservados · {APP_VERSION_LABEL}</>
        )}
      </span>
      <span className="app-footer-credit">
        Desarrollado por{" "}
        <a href="https://owncoding.dev" target="_blank" rel="noopener noreferrer">
          Owncoding
        </a>
      </span>
    </footer>
  );
}
