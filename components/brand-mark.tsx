/**
 * Marca de LedBox (mismo vector que el favicon `public/icon.svg`).
 * Fuente única: si cambia el logo, se cambia acá y en el asset público.
 */
export function BrandMark({ className, size }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="12" fill="#050505" />
      <path d="M13 16h38v8H13zm0 12h38v8H13zm0 12h26v8H13z" fill="#fff" />
      <circle cx="48" cy="44" r="7" fill="#00e5ff" />
    </svg>
  );
}
