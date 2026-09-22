/**
 * Respuestas del API. `code` es opcional y existe para los errores que el panel
 * debe distinguir de un problema de sesión: hoy solo `plan_limit` (issue #42),
 * que el cliente de `/api/admin/*` muestra inline en vez de cerrar la sesión.
 */
export function jsonError(message: string, status = 400, code?: string): Response {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Response(JSON.stringify({ error: "Request body must be valid JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
