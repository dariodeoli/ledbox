import { randomUUID } from "node:crypto";
import type { LeadStatus, Prisma } from "@prisma/client";
import { rucDocument } from "@/lib/field-rules";

/**
 * Lead → cliente, compartido por la conversión del pipeline (`PATCH /api/leads`)
 * y por el alta de presupuesto desde un lead (`POST /api/admin/budgets`).
 *
 * Anotado del #105 (Tanda 1 del plan #100): la librería tiene
 * `claveTelefonoCliente`/`coincideTelefonoCliente` para esto, pero todavía
 * **no salen por `owncoding-ui/utils`** (solo por el entry root); migrar cuando
 * upstream las publique en el subcamino, junto con `limpiarPercent`.
 */

/**
 * Clave nacional del teléfono para el dedup: solo dígitos, sin prefijo de país
 * ni 0 inicial, con la guarda de los números demasiado cortos (no identifican
 * a nadie).
 */
export function phoneKey(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "";
  if (digits.startsWith("595")) return digits.slice(3);
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

export type LeadContact = { name: string; company: string | null; email: string; phone: string; ruc: string | null };
export type ClientCandidate = { id: string; name: string; company: string | null; email: string | null; phone: string | null };

/** Primer cliente que coincide con el lead por email (sin mayúsculas) o por teléfono (clave nacional). */
export function findMatchingClient<T extends ClientCandidate>(candidates: readonly T[], lead: Pick<LeadContact, "email" | "phone">): T | undefined {
  const email = lead.email.trim().toLowerCase();
  const phone = phoneKey(lead.phone);
  return candidates.find(
    (candidate) =>
      (email.length > 0 && candidate.email?.trim().toLowerCase() === email) ||
      (phone.length > 0 && phoneKey(candidate.phone) === phone),
  );
}

export type ResolvedLeadClient = {
  client: { id: string; name: string; company: string | null };
  created: boolean;
};

/**
 * Obtiene el cliente del lead dentro de la empresa: reutiliza uno existente
 * (mismo email o teléfono) o crea un cliente FINAL. Acepta la transacción para
 * que el alta y lo que sigue sean atómicos.
 */
export async function resolveClientFromLead(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lead: LeadContact,
  options: { allowCreate?: boolean } = {},
): Promise<ResolvedLeadClient | null> {
  const candidates = await tx.client.findMany({
    where: { organizationId, OR: [{ email: { not: null } }, { phone: { not: null } }] },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { id: true, name: true, company: true, email: true, phone: true },
  });
  const existing = findMatchingClient(candidates, lead);
  if (existing) return { client: { id: existing.id, name: existing.name, company: existing.company }, created: false };
  if (options.allowCreate === false) return null;
  const created = await tx.client.create({
    data: {
      id: randomUUID(),
      organizationId,
      type: "FINAL",
      name: lead.name,
      company: lead.company || undefined,
      email: lead.email.trim().toLowerCase() || undefined,
      phone: lead.phone || undefined,
      ruc: rucDocument(lead.ruc) || undefined,
    },
    select: { id: true, name: true, company: true },
  });
  return { client: created, created: true };
}

/**
 * Estado del lead al armarle un presupuesto: un lead nuevo o contactado pasa a
 * Cotizado; cualquier otro (Cotizado, Ganado, Perdido) queda como está, así que
 * un lead ganado nunca baja.
 */
export function leadStatusAfterBudget(status: LeadStatus): LeadStatus {
  return status === "NEW" || status === "CONTACTED" ? "QUOTED" : status;
}
