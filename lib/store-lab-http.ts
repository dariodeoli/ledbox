/** No write dependency exists in this dispatcher: no preorders, contacts, mail or reservations. */
export async function dispatchStoreLab(request: Request, action: readonly string[], dependencies: {
  price: (raw: unknown) => Promise<unknown>;
  product: (code: string) => Promise<unknown | null>;
}): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method === "GET" && action.length === 2 && action[0] === "product") {
    const detail = await dependencies.product(action[1]);
    return Response.json(detail ? { detail } : { error: "Producto no encontrado." }, { status: detail ? 200 : 404, headers });
  }
  if (request.method !== "POST" || action.length !== 1 || !["cart", "preorder"].includes(action[0])) {
    return Response.json({ error: "Acción no disponible en el laboratorio." }, { status: 405, headers });
  }
  if (action[0] === "preorder") {
    // Do not parse, log, save or forward personal data even when a caller bypasses the UI.
    return Response.json({ simulated: true, message: "Prueba completada: no se guardó ni se envió ninguna preorden, cotización o reserva." }, { headers });
  }
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "Carrito inválido." }, { status: 400, headers });
  return Response.json({ cart: await dependencies.price(raw) }, { headers });
}
