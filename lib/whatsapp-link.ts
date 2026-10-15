/**
 * Único lugar donde se arma un link `wa.me` (docs/DEMO-INTERACTIVA.md §3; lo exige
 * `tests/demo-salidas.test.ts`). Es una función pura y sirve en cliente y servidor.
 *
 * En una sandbox de la demo (`sandbox: true`) devuelve `null`: nada sale hacia afuera y la
 * pantalla muestra «Así se vería el mensaje» en vez de abrir WhatsApp.
 */
export function waMeLink(
  internationalDigits: string,
  options: { text?: string | null; sandbox?: boolean } = {},
): string | null {
  if (options.sandbox) return null;
  const digits = String(internationalDigits || "").replace(/\D/g, "");
  if (!digits) return null;
  const text = String(options.text ?? "").trim();
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}
