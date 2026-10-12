export type PagaYaResponse = Record<string, unknown>;
export type PagaYaCheckoutInput = {
  priceVersionId: string;
  externalReference: string;
  customer: { name: string; email: string; phone: string };
};
export class PagaYaError extends Error {
  code: string;
  status: number;
  outcomeUnknown: boolean;
  retryAfterSeconds: number | null;
  constructor(code: string, options?: { status?: number; outcomeUnknown?: boolean; retryAfterSeconds?: number | null });
}
export interface PagaYaConnector {
  getCatalog(): Promise<PagaYaResponse>;
  createCheckout(input: PagaYaCheckoutInput, idempotencyKey: string): Promise<PagaYaResponse>;
  getCheckout(id: string): Promise<PagaYaResponse>;
  getSubscription(id: string): Promise<PagaYaResponse>;
  setRenewal(id: string, cancelAtPeriodEnd: boolean, idempotencyKey: string): Promise<PagaYaResponse>;
  createPortalSession(id: string): Promise<PagaYaResponse>;
}
export function createPagaYaClient(options: { baseUrl: string; apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }): PagaYaConnector;
export function verifyPagaYaWebhook(rawBody: string | Uint8Array, signature: string | null, secret: string, options?: { nowMs?: number; toleranceSeconds?: number }): boolean;
