import { buildCsv, type CsvCell } from "@/lib/admin-export";

/** Respuesta CSV de plataforma: celdas neutralizadas por `csvCell`, sin caché, descarga con nombre fijo. */
export function csvResponse(filename: string, header: string[], rows: CsvCell[][]): Response {
  return new Response(buildCsv([{ header, rows }]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function tooManyResponse(retryAfter: number): Response {
  return new Response("Demasiados intentos. Probá de nuevo en unos minutos.", {
    status: 429,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}
