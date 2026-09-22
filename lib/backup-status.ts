/**
 * Estado del respaldo (issue #43): reglas puras del estado que lee `/sistema`.
 *
 * Viven acá —sin I/O ni Prisma— para que el panel, el API y los tests usen la
 * misma definición de «vencido» y el mismo texto de antigüedad. Los archivos
 * reales los lee `lib/server/system-status.ts`.
 */

/** Estado real del respaldo, tal como lo dibuja el panel. */
export type BackupStatusValue = "ok" | "stale" | "failed" | "missing" | "never";

/**
 * Estado del respaldo: sin ningún ok (`never`), con el último intento fallido
 * (`failed`), con el archivo del último ok ausente (`missing`), superado el
 * umbral (`stale`) o en orden (`ok`). El orden de prioridad es el de la lista:
 * un fallo o un archivo ausente se reportan antes que un vencimiento.
 */
export function backupStatusOf(input: {
  lastRunStatus: "ok" | "failed" | null;
  hasSuccess: boolean;
  fileExists: boolean | null;
  ageHours: number | null;
  maxAgeHours: number;
}): BackupStatusValue {
  if (!input.hasSuccess) return "never";
  if (input.lastRunStatus === "failed") return "failed";
  if (input.fileExists === false) return "missing";
  if (input.ageHours !== null && input.ageHours > input.maxAgeHours) return "stale";
  return "ok";
}

/** Antigüedad legible: «3,4 h» hasta dos días y «2 días» de ahí en adelante. */
export function formatAgeLabel(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "sin datos";
  if (hours < 48) return `${hours.toLocaleString("es-PY", { maximumFractionDigits: 1 })} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "día" : "días"}`;
}
