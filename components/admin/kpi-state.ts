/** Estado de un indicador según los recursos de los que depende (regla «estados honestos»). */
export type KpiState = "loading" | "error" | "ready";

type KpiResource = { data: unknown; loading: boolean; error?: string };

/** Algún recurso está cargando y todavía no tiene datos. */
export function kpiLoading(...resources: KpiResource[]): boolean {
  return resources.some((resource) => resource.loading && resource.data == null);
}

/**
 * «loading» mientras algún recurso carga sin datos; «error» si alguno falló y
 * sigue sin datos (se muestra «—», nunca un 0 inventado); si no, «ready».
 */
export function kpiState(...resources: KpiResource[]): KpiState {
  if (kpiLoading(...resources)) return "loading";
  if (resources.some((resource) => resource.data == null)) return "error";
  return "ready";
}
