export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
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
