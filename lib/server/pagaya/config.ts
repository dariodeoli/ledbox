import "server-only";

export type PagaYaMode = "test" | "live";
export type PagaYaConfig = Readonly<{
  appId: string;
  mode: PagaYaMode;
  baseUrl: string;
  apiKey: string;
  checkoutWrite: boolean;
  subscriptionRead: boolean;
  subscriptionWrite: boolean;
}>;

export class PagaYaConfigurationError extends Error {
  constructor() { super("pagaya_not_configured"); }
}

/** App identity and each command capability are explicit server-side settings. */
export function readPagaYaConfig(env: NodeJS.ProcessEnv = process.env): PagaYaConfig {
  const appId = env.PAGAYA_APP_ID ?? "";
  const mode = env.PAGAYA_MODE;
  const apiKey = env.PAGAYA_APP_API_KEY ?? "";
  const baseUrl = env.PAGAYA_BASE_URL ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId) ||
      (mode !== "test" && mode !== "live") || !/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(apiKey) || !apiKey.startsWith(`pk_${mode}_`)) {
    throw new PagaYaConfigurationError();
  }
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new PagaYaConfigurationError(); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new PagaYaConfigurationError();
  }
  function optIn(key: string): boolean {
    const value = env[key];
    if (value !== undefined && value !== "true" && value !== "false") throw new PagaYaConfigurationError();
    return value === "true";
  }
  return Object.freeze({ appId, mode, apiKey, baseUrl: url.origin,
    checkoutWrite: optIn("PAGAYA_CHECKOUT_WRITE_ENABLED"),
    subscriptionRead: optIn("PAGAYA_SUBSCRIPTION_READ_ENABLED"),
    subscriptionWrite: optIn("PAGAYA_SUBSCRIPTION_WRITE_ENABLED"),
  });
}
