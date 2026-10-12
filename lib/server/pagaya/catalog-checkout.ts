import "server-only";
import { PagaYaError } from "./pagaya-server.mjs";
import { requirePagaYaCapability, type PagaYaServerClient } from "./client";
import type { PagaYaRepository } from "./repository";
import type { PagaYaOwner } from "./types";

export type PagaYaBillingContext = { owner: PagaYaOwner; repository: PagaYaRepository; client: PagaYaServerClient };

export async function getPagaYaCatalog(context: PagaYaBillingContext) {
  return context.client.connector.getCatalog();
}

export async function createCatalogCheckout(context: PagaYaBillingContext, enrollmentId: string) {
  requirePagaYaCapability(context.client, "checkoutWrite");
  await context.repository.getOwnedEnrollment(context.owner, enrollmentId);
  // PF's actual enrollment contract has no verified billing customer/phone.
  // Plan42 prices are not approved PagaYa price versions, and browser customer
  // data cannot fill this gap. No command or POST may precede that provenance.
  throw new PagaYaError("billing_customer_unavailable", { status: 503 });
}

export async function getOwnedCheckout(context: PagaYaBillingContext, enrollmentId: string) {
  const enrollment = await context.repository.getOwnedEnrollment(context.owner, enrollmentId);
  if (!enrollment.checkoutId) throw new PagaYaError("not_found", { status: 404 });
  // saveCheckoutRead requires app/mode/externalReference from a real wire
  // adapter. The public connector guide alone does not specify those paths.
  throw new PagaYaError("wire_contract_unavailable", { status: 503 });
}
