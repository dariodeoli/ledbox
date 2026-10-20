import { requireAdminContext, type AdminContext } from "@/lib/server/tenancy";

/** Adapter boundary for future OAuth 2.1/PKCE. Current release accepts only
 * the application's existing session cookie or scoped API bearer token. */
export type McpAuthProvider = () => Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; response: Response }
>;

export const resolveMcpCaller: McpAuthProvider = () => requireAdminContext();
