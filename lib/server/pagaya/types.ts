/** Local normalized contracts. FIN adapters translate the actual PagaYa wire
 * projection; these types are not a claim about undocumented wire fields. */
export type PagaYaMode = "test" | "live";
export type PagaYaOwner = { organizationId: string; adminUserId: string; appId: string; mode: PagaYaMode };
export type PagaYaCustomer = { name: string; email: string; phone: string };
export type PagaYaCustomerProvenance = { sourceReference: string; approvedByAdminUserId: string; approvedAt: string };
export type PagaYaEnrollment = PagaYaOwner & {
  id: string; externalReference: string; approvedPriceVersionId: string; customer: PagaYaCustomer;
  customerProvenance: PagaYaCustomerProvenance;
  checkoutId: string | null; subscriptionId: string | null;
};
export type PagaYaCommandKind = "CHECKOUT" | "RENEWAL";
export type PagaYaCommandState = "PREPARED" | "SUBMITTING" | "UNKNOWN" | "SUCCEEDED" | "FAILED";
export type PagaYaCommand = {
  id: string; enrollmentId: string; intentId: string; kind: PagaYaCommandKind;
  commandKey: string; resourceId: string | null; requestBody: string; bodySHA256: string; state: PagaYaCommandState;
  version: number; responseBody: unknown | null;
};
export type PagaYaEventType = "payment.succeeded" | "payment.failed" | "invoice.paid" | "invoice.payment_failed"
  | "subscription.updated" | "subscription.cancelled" | "refund.processed";
export type PagaYaInboxEvent = {
  id: string; type: PagaYaEventType; appId: string; mode: PagaYaMode;
  externalReference: string | null; checkoutId: string | null; subscriptionId: string | null;
};
export type PagaYaCheckoutRead = {
  id: string; appId: string; mode: PagaYaMode; externalReference: string; priceVersionId: string;
  subscriptionId: string | null;
};
/** paidPeriod must be independently confirmed by FIN's app-scoped read
 * adapter, not inferred from a redirect, webhook or arbitrary status string.
 * null means no confirmed paid period. No trial/grace/quota mapping is implied. */
export type PagaYaSubscriptionRead = {
  id: string; appId: string; mode: PagaYaMode; externalReference: string; checkoutId: string;
  status: string; cancelAtPeriodEnd: boolean; pendingRenewalMutation: unknown | null;
  paidPeriod: { startsAt: string; endsAt: string } | null;
};
export type PagaYaReadAdapter = {
  getCheckout(id: string): Promise<PagaYaCheckoutRead>;
  getSubscription(id: string): Promise<PagaYaSubscriptionRead>;
};
export type PagaYaWebhookAdapter = {
  expectedAppId: string; expectedMode: PagaYaMode; webhookSecret: string;
  /** FIN's byte-identical official verifyPagaYaWebhook export. */
  verifyPagaYaWebhook(raw: Uint8Array, signature: string | null, secret: string,
    options: { nowMs: number; toleranceSeconds: 300 }): boolean;
  /** Must validate/translate the actual wire envelope without guessing IDs. */
  decodeEvent(payload: unknown): PagaYaInboxEvent;
};
