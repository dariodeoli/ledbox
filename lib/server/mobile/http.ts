import { z } from "zod";

export function mobileJSON(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization" } });
}

export async function mobileInput<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return { ok: false, response: mobileJSON({ error: "Se requiere JSON.", code: "invalid_content_type" }, 415) };
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return { ok: false, response: mobileJSON({ error: "Datos inválidos.", code: "invalid_input" }, 400) };
    return { ok: true, data: parsed.data };
  } catch { return { ok: false, response: mobileJSON({ error: "JSON inválido.", code: "invalid_json" }, 400) }; }
}
