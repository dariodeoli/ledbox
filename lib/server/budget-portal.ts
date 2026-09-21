import { randomBytes } from "node:crypto";
import { db } from "./db";
import { BUDGET_CODE_ALPHABET, formatBudgetCode, normalizeBudgetCode } from "@/lib/public-config";
import { budgetReference } from "@/lib/admin-format";

/**
 * Portal del cliente (issue #12): acceso público por token y armado del
 * presupuesto sanitizado.
 *
 * Única puerta de entrada de `app/api/portal/*` y de las páginas
 * `app/(portal)/*`: busca por el código del link (nunca por id), y devuelve
 * solo lo que el cliente puede ver —ítems con precio de venta, totales,
 * descuento, validez, notas, cliente y evento—. El costo interno, el margen,
 * los cobros y la evidencia técnica (IP/user-agent) no salen nunca del panel.
 */

const CODE_LENGTH = 20;

export type PortalBudgetApprovalState = "PENDIENTE" | "APROBADO_DIGITAL" | "APROBADO_MANUAL" | "CAMBIOS_SOLICITADOS";

export type PortalBudgetItem = {
  id: string;
  name: string;
  quantity: number;
  days: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
};

export type PortalBudget = {
  reference: string;
  title: string;
  /** Enum real del presupuesto (`CommercialStatus`); la UI lo traduce. */
  status: string;
  organization: string;
  createdAt: string;
  validUntil: string | null;
  notes: string | null;
  client: { name: string; company: string | null };
  event: { name: string; location: string | null; startsAt: string | null } | null;
  items: PortalBudgetItem[];
  subtotal: number;
  discount: number;
  total: number;
  approval: {
    state: PortalBudgetApprovalState;
    approvedAt: string | null;
    approvedByName: string | null;
    method: "digital" | "manual" | null;
    note: string | null;
    revisionRequestedAt: string | null;
    revisionNote: string | null;
  };
};

/** Código nuevo (100 bits) en grupos de cuatro, generado con azar del sistema. */
export function generatePublicToken(): string {
  const chars: string[] = [];
  while (chars.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      // Descarta el resto para no sesgar el alfabeto (32 símbolos: 256 / 32 = 8).
      if (byte >= 256 - (256 % BUDGET_CODE_ALPHABET.length)) continue;
      chars.push(BUDGET_CODE_ALPHABET[byte % BUDGET_CODE_ALPHABET.length]);
      if (chars.length === CODE_LENGTH) break;
    }
  }
  return formatBudgetCode(chars.join(""));
}

/** Día en que se puede aprobar: un presupuesto perdido o cancelado ya no está en juego. */
export function portalBudgetOpen(status: string): boolean {
  return status !== "LOST" && status !== "CANCELLED";
}

type BudgetForPortal = {
  id: string;
  title: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  approvedByName: string | null;
  approvalMethod: string | null;
  approvalNote: string | null;
  revisionRequestedAt: Date | null;
  revisionNote: string | null;
  organization: { name: string };
  client: { name: string; company: string | null };
  event: { name: string; location: string | null; startsAt: Date | null } | null;
  items: Array<{ id: string; name: string; quantity: number; days: number; unitPrice: number; subtotal: number; notes: string | null }>;
};

function approvalState(budget: BudgetForPortal): PortalBudgetApprovalState {
  if (budget.approvedAt) return budget.approvalMethod === "manual" ? "APROBADO_MANUAL" : "APROBADO_DIGITAL";
  if (budget.revisionRequestedAt) return "CAMBIOS_SOLICITADOS";
  return "PENDIENTE";
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Vista pública del presupuesto: solo campos de venta y aprobación. */
export function portalBudgetView(budget: BudgetForPortal): PortalBudget {
  const method = budget.approvalMethod === "manual" ? "manual" : budget.approvalMethod === "digital" ? "digital" : null;
  return {
    reference: budgetReference(budget.id),
    title: budget.title,
    status: budget.status,
    organization: budget.organization.name,
    createdAt: budget.createdAt.toISOString(),
    validUntil: iso(budget.validUntil),
    notes: budget.notes,
    client: { name: budget.client.name, company: budget.client.company },
    event: budget.event
      ? { name: budget.event.name, location: budget.event.location, startsAt: iso(budget.event.startsAt) }
      : null,
    items: budget.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      days: item.days,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      notes: item.notes,
    })),
    subtotal: budget.subtotal,
    discount: budget.discount,
    total: budget.total,
    approval: {
      state: approvalState(budget),
      approvedAt: iso(budget.approvedAt),
      approvedByName: budget.approvedByName,
      method,
      note: budget.approvalNote,
      revisionRequestedAt: iso(budget.revisionRequestedAt),
      revisionNote: budget.revisionNote,
    },
  };
}

const portalInclude = {
  organization: { select: { name: true } },
  client: { select: { name: true, company: true } },
  event: { select: { name: true, location: true, startsAt: true } },
  items: { orderBy: { name: "asc" } },
} as const;

/** Presupuesto público por código de link; `null` si no existe o no tiene token. */
export async function loadPublicBudget(token: string | null | undefined): Promise<PortalBudget | null> {
  const code = normalizeBudgetCode(token);
  if (!code) return null;
  const budget = await db.budget.findUnique({ where: { publicToken: code }, include: portalInclude });
  return budget ? portalBudgetView(budget) : null;
}

/** Evidencia de la aprobación digital: IP y user-agent del pedido. */
export function approvalEvidence(request: Request): { ip: string; userAgent: string } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const userAgent = (request.headers.get("user-agent") || "unknown").slice(0, 300);
  return { ip, userAgent };
}
