/**
 * Hora límite de una sandbox de la demo (docs/DEMO-INTERACTIVA.md §1): vence a 1 h sin uso o a las 24 h
 * desde el alta, lo que llegue primero. Módulo puro (sirve en cliente y servidor); mismos números que
 * `SANDBOX_IDLE_MS` de `lib/server/demo-sandbox.ts` (un test los compara).
 */
export const SANDBOX_IDLE_LIMIT_MS = 60 * 60 * 1000;

/** Instante límite, o `null` si no hay ningún dato (no se inventa una hora). */
export function sandboxDeadline(input: { lastSeenAt?: string | Date | null; expiresAt?: string | Date | null }): Date | null {
  const times: number[] = [];
  const last = input.lastSeenAt ? new Date(input.lastSeenAt).getTime() : NaN;
  if (Number.isFinite(last)) times.push(last + SANDBOX_IDLE_LIMIT_MS);
  const cap = input.expiresAt ? new Date(input.expiresAt).getTime() : NaN;
  if (Number.isFinite(cap)) times.push(cap);
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}
