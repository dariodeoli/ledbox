/** Results count destinations, not files: an extras destination is one complete gallery. */
export type PhotoScope = "producto" | "adicionales" | "categoria" | "coleccion";
export type PhotoResult = { alcance: PhotoScope; codigo: string; estado: "modificada" | "conservada" | "fallida" | "sin_archivo"; motivo: string; cambioAplicado: boolean };
export function initialPhotoResult(alcance: PhotoScope, codigo: string, declared: boolean, resolved: boolean, zip: boolean): PhotoResult {
  return { alcance, codigo, estado: "sin_archivo", cambioAplicado: false,
    motivo: !declared ? "Sin foto declarada; se conserva lo existente." : !zip ? "Sin ZIP; se conserva lo existente." : !resolved ? "Archivo ausente del ZIP; se conserva lo existente." : "Pendiente de aplicar." };
}
export function photoResult(initial: PhotoResult, changed: boolean, error?: string | null): PhotoResult {
  return { ...initial, estado: error ? "fallida" : changed ? "modificada" : "conservada", cambioAplicado: changed,
    motivo: error ?? (changed ? "Cambio guardado." : "Contenido idéntico; se conserva sin reescribir.") };
}
export function summarizePhotoResults(rows: readonly PhotoResult[]) {
  return { destinos: rows.length, modificadas: rows.filter(r => r.estado === "modificada").length,
    conservadas: rows.filter(r => r.estado === "conservada").length, fallidas: rows.filter(r => r.estado === "fallida").length,
    sinArchivo: rows.filter(r => r.estado === "sin_archivo").length, cambiosAplicados: rows.filter(r => r.cambioAplicado).length };
}
