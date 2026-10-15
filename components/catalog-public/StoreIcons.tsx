/** Iconos de línea (SVG) de la tienda. Decorativos: el dato siempre va escrito al lado. */
export type XIconName = "users" | "ruler" | "puzzle" | "tag" | "cart" | "close" | "box" | "search" | "check" | "plus" | "minus" | "bag" | "alert";

const PATHS: Record<XIconName, string> = {
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 5.2a3 3 0 0 1 0 5.6",
  ruler: "M3 15.5 15.5 3 21 8.5 8.5 21zM7 12l2.5 2.5M10 9l2 2M13 6l2.5 2.5",
  puzzle: "M10 4a2 2 0 1 1 4 0v1h4v4h-1a2 2 0 1 0 0 4h1v4h-4v-1a2 2 0 1 0-4 0v1H6v-4H5a2 2 0 1 1 0-4h1V5h4z",
  tag: "M3 12V4h8l9 9-8 8zM7.5 8.5h.01",
  cart: "M3 5h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.76L19.5 8H6.2M9.5 20.2a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zM16.5 20.2a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z",
  close: "M6 6l12 12M18 6L6 18",
  box: "M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3ZM3.5 7.5 12 12l8.5-4.5M12 12v9",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  bag: "M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2",
  alert: "M12 8v5M12 16.5h.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
};

export function XIcon({ name, size = 18 }: { name: XIconName; size?: number }) {
  return (
    <svg className="cp-x-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Foto que falta: icono de línea sobre un degradé suave del tema. Nunca letras sueltas. */
export function ProductPlaceholder({ size = 40, label }: { size?: number; label?: string }) {
  return (
    <span className="cp-ph" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <XIcon name="box" size={size} />
    </span>
  );
}
