import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { budgetReference } from "@/lib/admin-format";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import { stableOrderBudgetItems } from "@/lib/budget-item-order";
import { paymentPlanOf } from "../budget-portal";
import { canonicalJson, sha256Hex, verifySignatureChain } from "./hash";

/**
 * Documento firmable y sus huellas (issue #79).
 *
 * Sin adjunto PDF, el documento es la **representación canónica** del
 * presupuesto tal como la ve el cliente (título, partes, ítems con precio de
 * venta, totales y plan de pagos): la misma estructura dibuja el visor del
 * portal y la hoja imprimible. `documentHash` sella esa representación al crear
 * la solicitud y `signedDocumentHash` sella la versión con la firma incorporada
 * (documento + bloque de cierre), con la versión del formato incluida para que
 * un cambio futuro no mezcle huellas.
 */

/** Versión del formato de huella; si cambia la forma, sube y no se compara contra la anterior. */
export const SIGNATURE_DOCUMENT_VERSION = 1;
export const SNAPSHOT_DOCUMENT_VERSION = 2;
export type SignatureDocumentVersion = 1 | 2;

/** V2 recibe el orden original del query; v1 conserva explícitamente name asc. */
export const signatureBudgetSelect = {
  id: true, title: true, createdAt: true, validUntil: true, deliveryAt: true,
  ivaType: true, warranty: true, notes: true, paymentTerms: true, advanceAmount: true,
  installmentsJson: true, subtotal: true, discount: true, total: true,
  client: { select: { name: true, company: true, tradeName: true, legalName: true } },
  event: { select: { name: true, location: true, startsAt: true, endsAt: true } },
  items: { select: { name: true, quantity: true, days: true, unitPrice: true, excluded: true, subtotal: true, notes: true, sortOrder: true } },
} as const;
export const signatureLegacyBudgetSelect = { ...signatureBudgetSelect, items: { ...signatureBudgetSelect.items, orderBy: { name: "asc" } } } as const;
type SignatureBudgetSource = Prisma.BudgetGetPayload<{ select: typeof signatureBudgetSelect }>;

export type SignatureDocumentItem = {
  name: string;
  excluded?: boolean;
  quantity: number;
  days: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
};

export type SignatureDocumentInstallment = { label: string; amount: number; dueAt: string | null };

/** Datos del presupuesto que forman el documento firmable (sin costos internos). */
export type SignatureBudgetDocument = {
  /** Ausente en documentos legacy; nunca se añade al payload/hash v1. */
  documentVersion?: SignatureDocumentVersion;
  budgetId: string;
  reference: string;
  title: string;
  organizationName: string;
  client: { name: string; company: string | null; displayName?: string; tradeName?: string | null; legalName?: string | null };
  event: { name: string; location: string | null; startsAt: string | null } | null;
  createdAt: string;
  validUntil: string | null;
  deliveryAt: string | null;
  ivaType: string | null;
  warranty: string | null;
  notes: string | null;
  paymentTerms: string | null;
  items: SignatureDocumentItem[];
  subtotal: number;
  discount: number;
  total: number;
  plan: {
    advanceAmount: number;
    installments: SignatureDocumentInstallment[];
    dueNow: { label: string; amount: number } | null;
    pending: number;
  };
};

/** Documento canónico del presupuesto (lo que se firma y lo que se imprime). */
export function budgetDocumentPayload(budget: SignatureBudgetDocument): Record<string, unknown> {
  const version = budget.documentVersion ?? SIGNATURE_DOCUMENT_VERSION;
  return {
    format: "eventos-budget",
    version,
    budgetId: budget.budgetId,
    reference: budget.reference,
    title: budget.title,
    organizationName: budget.organizationName,
    client: version === 1
      ? { name: budget.client.name, company: budget.client.company }
      : { name: budget.client.name, company: budget.client.company, displayName: budget.client.displayName, tradeName: budget.client.tradeName, legalName: budget.client.legalName },
    event: budget.event,
    createdAt: budget.createdAt,
    validUntil: budget.validUntil,
    deliveryAt: budget.deliveryAt,
    ivaType: budget.ivaType,
    warranty: budget.warranty,
    notes: budget.notes,
    paymentTerms: budget.paymentTerms,
    items: budget.items.map((item) => ({
      name: item.name,
      ...(item.excluded ? { excluded: true } : {}),
      quantity: item.quantity,
      days: item.days,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      notes: item.notes,
    })),
    subtotal: budget.subtotal,
    discount: budget.discount,
    total: budget.total,
    plan: budget.plan,
  };
}

/** Huella del documento canónico (sin adjunto). */
export function budgetDocumentHash(payload: Record<string, unknown>): string {
  const version = payload.version ?? SIGNATURE_DOCUMENT_VERSION;
  if (version !== 1 && version !== 2) throw new Error("Versión de documento no soportada");
  return sha256Hex(canonicalJson({ kind: "budget-document", version, payload }));
}

const nullableText = z.string().nullable();
const money = z.number().int().nonnegative();
const snapshotSchema = z.object({
  format: z.literal("eventos-budget"), version: z.literal(2),
  budgetId: z.string(), reference: z.string(), title: z.string(), organizationName: z.string(),
  client: z.object({ name: z.string(), company: nullableText, displayName: z.string(), tradeName: nullableText, legalName: nullableText }).strict(),
  event: z.object({ name: z.string(), location: nullableText, startsAt: nullableText }).strict().nullable(),
  createdAt: z.string(), validUntil: nullableText, deliveryAt: nullableText, ivaType: nullableText,
  warranty: nullableText, notes: nullableText, paymentTerms: nullableText,
  items: z.array(z.object({ name: z.string(), quantity: z.number().int(), days: z.number().int(), unitPrice: money, subtotal: money, notes: nullableText, excluded: z.literal(true).optional() }).strict()),
  subtotal: money, discount: money, total: money,
  plan: z.object({ advanceAmount: money, installments: z.array(z.object({ label: z.string(), amount: money, dueAt: nullableText }).strict()), dueNow: z.object({ label: z.string(), amount: money }).strict().nullable(), pending: money }).strict(),
}).strict();

/** Una sola fábrica pública; los dos sources devuelven el mismo contrato sin costos. */
export function signatureDocument(input:
  | { source: "live"; version: SignatureDocumentVersion; budget: SignatureBudgetSource; title: string; organizationName: string }
  | { source: "snapshot"; payload: unknown },
): SignatureBudgetDocument {
  if (input.source === "snapshot") {
    const parsed = snapshotSchema.safeParse(input.payload);
    if (!parsed.success) throw new Error("El snapshot del documento no es válido.");
    const { format: _format, version, ...document } = parsed.data;
    return { ...document, documentVersion: version };
  }
  const { budget, version } = input;
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  const plan = paymentPlanOf(budget);
  return {
    ...(version === 2 ? { documentVersion: version } : {}),
    budgetId: budget.id, reference: budgetReference(budget.id), title: input.title, organizationName: input.organizationName,
    client: { name: budget.client.name, company: budget.client.company, ...(version === 2 ? { displayName: clientDisplayName(budget.client), tradeName: budget.client.tradeName, legalName: clientLegalName(budget.client) } : {}) },
    event: budget.event ? { name: budget.event.name, location: budget.event.location, startsAt: iso(budget.event.startsAt) } : null,
    createdAt: budget.createdAt.toISOString(), validUntil: iso(budget.validUntil), deliveryAt: iso(budget.deliveryAt), ivaType: budget.ivaType, warranty: budget.warranty, notes: budget.notes, paymentTerms: budget.paymentTerms,
    items: (version === 2 ? stableOrderBudgetItems(budget.items) : budget.items).map(item => ({ name: item.name, quantity: item.quantity, days: item.days, unitPrice: item.unitPrice, subtotal: item.subtotal, excluded: item.excluded, notes: item.notes })),
    subtotal: budget.subtotal, discount: budget.discount, total: budget.total,
    plan: { advanceAmount: plan.advanceAmount, installments: plan.installments, dueNow: plan.dueNow, pending: plan.pending },
  };
}

type DocumentRequest = {
  id: string; budgetId: string; attachmentId: string | null; documentHash: string;
  events: Parameters<typeof verifySignatureChain>[0];
};
/** Metadata versionada sólo en REQUEST_CREATED; nunca se reescribe la cadena. */
export function signatureCreationMetadata(row: DocumentRequest): Record<string, unknown> | null {
  const creation = row.events.find(event => event.eventType === "REQUEST_CREATED");
  return creation?.metadataJson && typeof creation.metadataJson === "object" && !Array.isArray(creation.metadataJson)
    ? creation.metadataJson as Record<string, unknown> : null;
}
export function signatureRequestDocumentVersion(row: DocumentRequest): SignatureDocumentVersion {
  const metadata = signatureCreationMetadata(row);
  if (metadata?.documentVersion === undefined && metadata?.documentSnapshot === undefined) return 1;
  if (metadata?.documentVersion !== 2) throw new Error("La versión del documento no está disponible.");
  return 2;
}
/** V2 prueba cadena, snapshot, huella pública y vínculo con la solicitud/adjunto. */
export function verifiedSignatureSnapshot(row: DocumentRequest): SignatureBudgetDocument | null {
  if (row.events.some(event => event.requestId !== row.id) || !verifySignatureChain(row.events).valid) throw new Error("La cadena del documento no es válida.");
  if (signatureRequestDocumentVersion(row) === 1) return null;
  const metadata = signatureCreationMetadata(row)!;
  if (row.events[0]?.eventType !== "REQUEST_CREATED") throw new Error("La cadena del documento no es válida.");
  const document = signatureDocument({ source: "snapshot", payload: metadata.documentSnapshot });
  const hash = budgetDocumentHash(budgetDocumentPayload(document));
  if (document.budgetId !== row.budgetId || metadata.documentSnapshotHash !== hash || metadata.commercialHash !== hash || metadata.documentoHash !== row.documentHash || (!row.attachmentId && row.documentHash !== hash)) throw new Error("El snapshot no coincide con la huella del documento.");
  return document;
}

/** Huella de un adjunto (PDF/imagen): SHA-256 de los bytes reales. */
export function attachmentDocumentHash(data: Uint8Array): string {
  return sha256Hex(data);
}

/** Datos del sello que se incorpora al documento firmado. */
export type SignatureSeal = {
  documentHash: string;
  signatureIdentifier: string;
  signedAt: Date | string;
  provider: string;
  method: string;
  signerName: string;
};

/**
 * Huella del documento firmado: la huella original + el bloque de cierre
 * (identificador, sello, método y firmante). La Fase 1 no embebe la firma en el
 * binario del PDF; el documento firmado es el original más este bloque, que es
 * el que muestran la hoja imprimible y la auditoría.
 */
export function signedDocumentHash(seal: SignatureSeal): string {
  return sha256Hex(
    canonicalJson({
      kind: "signed-budget-document",
      version: SIGNATURE_DOCUMENT_VERSION,
      documentHash: seal.documentHash,
      signatureIdentifier: seal.signatureIdentifier,
      signedAt: seal.signedAt instanceof Date ? seal.signedAt.toISOString() : seal.signedAt,
      provider: seal.provider,
      method: seal.method,
      signerName: seal.signerName,
    }),
  );
}

/**
 * Identificador de firma legible y único: `FIRMA-YYYYMMDD-XXXXXXXX`
 * (`random` es el fragmento aleatorio en hex que provee el proveedor).
 */
export function signatureIdentifierFor(now: Date, random: string): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = random.replace(/[^0-9A-F]/gi, "").toUpperCase().padEnd(8, "0").slice(0, 8);
  return `FIRMA-${day}-${suffix}`;
}
