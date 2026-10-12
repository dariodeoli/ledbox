import "server-only";
import { createPagaYaClient, PagaYaError, type PagaYaConnector } from "./pagaya-server.mjs";
import { readPagaYaConfig, type PagaYaConfig } from "./config";
import type { PagaYaWebhookAdapter } from "./types";

export type PagaYaServerClient = Readonly<{ config: PagaYaConfig; connector: PagaYaConnector }>;

export function createPagaYaServerClient(config = readPagaYaConfig(), fetchImpl?: typeof globalThis.fetch): PagaYaServerClient {
  return Object.freeze({ config, connector: createPagaYaClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, fetch: fetchImpl }) });
}

export function requirePagaYaCapability(client: PagaYaServerClient, capability: "checkoutWrite" | "subscriptionRead" | "subscriptionWrite"): void {
  if (!client.config[capability]) throw new PagaYaError("permission_denied", { status: 403 });
}

/** The public guide does not define wire envelope paths. Never invent a
 * decoder or certify app/mode/correlation from an unvalidated payload. */
export function getPagaYaWebhookAdapter(): PagaYaWebhookAdapter {
  throw new PagaYaError("wire_contract_unavailable", { status: 503 });
}
