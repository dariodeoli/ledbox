import { formatNumber } from "./admin-format";

/** Presentation only: missing counts are not evidence of zero available units. */
export function inventoryAvailabilityLabel(
  count: number | null | undefined,
  kind: "free" | "committed" = "free",
  withUnits = false,
): string {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return kind === "free" ? "Sin datos de disponibilidad" : "Sin datos de unidades comprometidas";
  }
  const singular = count === 1;
  const adjective = kind === "free" ? (singular ? "libre" : "libres") : (singular ? "comprometida" : "comprometidas");
  return `${formatNumber(count)} ${withUnits ? `${singular ? "unidad" : "unidades"} ` : ""}${adjective}`;
}
