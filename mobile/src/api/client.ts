import type { Contract, DeletionResult, Endpoint, EventDetail, MobileEvent, Profile, Session, WireSession, WireEvents, WireCalendar } from "./contract";
import { eventView } from "./event-adapter";

export class MobileError extends Error {
  constructor(public code: "CONTRACT_PENDING" | "CONFIGURATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "STALE_CONTEXT" | "NETWORK" | "INVALID_RESPONSE" | "HTTP", message: string, public status?: number) {
    super(message);
    this.name = "MobileError";
  }
}
export type SecretStore = { read(): Promise<string | null>; write(token: string): Promise<void>; clear(): Promise<void> };
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
export type CalendarResult = { events: MobileEvent[]; timeZone: "America/Asuncion"; truncated: boolean };

/** User-session transport only; no cookie/service-key fallback. Every tenant transition
 * invalidates in-flight reads; stale responses cannot repopulate the old company. */
export class MobileClient {
  private token: string | null = null;
  private generation = 0;
  private pending = new Set<AbortController>();
  onExpired: (() => void) | null = null;
  constructor(private origin: string, private contract: Contract, private secrets: SecretStore, private fetcher: Fetcher = fetch, private allowLocal = false, private privacyUrl = "") {}

  private invalidate() {
    this.generation++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
  private async clearSession() {
    this.token = null;
    this.invalidate();
    try { await this.secrets.clear(); } finally { this.onExpired?.(); }
  }
  private url(endpoint: Endpoint, query?: Record<string, string>) {
    const route = this.contract.routes[endpoint];
    if (this.contract.status !== "BOUND_PF" || !this.contract.version || !route) throw new MobileError("CONTRACT_PENDING", "Contrato móvil PF pendiente para esta función.");
    let origin: URL;
    try { origin = new URL(this.origin); } catch { throw new MobileError("CONFIGURATION", "Configurá la URL HTTPS del backend móvil."); }
    const local = this.allowLocal && ["localhost", "127.0.0.1"].includes(origin.hostname) && origin.protocol === "http:";
    if ((!local && origin.protocol !== "https:") || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new MobileError("CONFIGURATION", "La URL del backend debe ser un origen HTTPS sin credenciales.");
    if (!/^\/api\/mobile\/[a-zA-Z0-9/_-]+$/.test(route)) throw new MobileError("CONFIGURATION", "Ruta fuera del contrato móvil.");
    const url = new URL(route, origin);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return url.toString();
  }
  private async request<T>(endpoint: Endpoint, method = "GET", body?: unknown, query?: Record<string, string>, authenticated = true): Promise<T> {
    const url = this.url(endpoint, query);
    if (authenticated && !this.token) throw new MobileError("UNAUTHENTICATED", "Ingresá para continuar.", 401);
    const generation = this.generation;
    const controller = new AbortController();
    this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(url, {
        method, signal: controller.signal, credentials: "omit", redirect: "error",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (generation !== this.generation) throw new MobileError("STALE_CONTEXT", "La empresa activa cambió; actualizá los datos.");
      if (response.status === 401) {
        if (endpoint === "deleteAccount") {
          const failure = await response.json().catch(() => null) as { code?: string } | null;
          if (failure?.code === "reauthentication_required") throw new MobileError("UNAUTHENTICATED", "Contraseña actual incorrecta. Tu cuenta no fue eliminada.", 401);
        }
        if (authenticated) await this.clearSession();
        throw new MobileError("UNAUTHENTICATED", authenticated ? "La sesión venció. Volvé a ingresar." : "Correo o contraseña incorrectos.", 401);
      }
      if (response.status === 403) throw new MobileError("FORBIDDEN", "Tu rol no tiene acceso a esta función.", 403);
      if (response.status === 423) throw new MobileError("HTTP", "La sesión está bloqueada. Desbloqueala desde el panel o cerrá sesión.", 423);
      if (response.status === 409 && endpoint === "deleteAccount") throw new MobileError("HTTP", "No se pudo eliminar la cuenta. Si sos el último propietario, transferí ese rol antes de reintentar.", 409);
      if (!response.ok) throw new MobileError("HTTP", response.status === 429 ? "Demasiados intentos. Esperá y volvé a intentar." : "El servidor no pudo completar la solicitud.", response.status);
      if (!response.headers.get("content-type")?.includes("application/json")) throw new MobileError("INVALID_RESPONSE", "El backend no devolvió el contrato JSON esperado.");
      const data: unknown = await response.json();
      if (generation !== this.generation) throw new MobileError("STALE_CONTEXT", "La empresa activa cambió.");
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new MobileError("INVALID_RESPONSE", "Respuesta móvil inválida.");
      return data as T;
    } catch (error) {
      if (error instanceof MobileError) throw error;
      if (generation !== this.generation) throw new MobileError("STALE_CONTEXT", "La empresa activa cambió.");
      throw new MobileError("NETWORK", "No se pudo conectar. Revisá tu conexión y reintentá.");
    } finally { clearTimeout(timer); this.pending.delete(controller); }
  }
  async restore(): Promise<Session | null> {
    this.token = await this.secrets.read();
    return this.token ? this.session() : null;
  }
  async login(email: string, password: string): Promise<Session> {
    const result = await this.request<{ version: 1; session: { accessToken: string; tokenType: string; expiresAt: string } }>("login", "POST", { email: email.trim().toLowerCase(), password }, undefined, false);
    if (result.version !== 1 || result.session?.tokenType !== "Bearer" || typeof result.session.accessToken !== "string" || !result.session.accessToken) throw new MobileError("INVALID_RESPONSE", "Sesión móvil inválida.");
    this.invalidate();
    this.token = result.session.accessToken;
    try { await this.secrets.write(this.token); } catch { await this.clearSession(); throw new MobileError("CONFIGURATION", "No se pudo guardar la sesión de forma segura."); }
    return this.session();
  }
  async session(): Promise<Session> {
    const data = await this.request<WireSession>("session");
    if (data.version !== 1 || !data.user?.id || !Array.isArray(data.organizations) || !data.session?.expiresAt) throw new MobileError("INVALID_RESPONSE", "Perfil de sesión inválido.");
    return { user: data.user, companies: data.organizations, activeCompanyId: data.activeOrganization?.id ?? null, expiresAt: data.session.expiresAt };
  }
  async switchCompany(companyId: string) {
    this.invalidate();
    const result = await this.request<{ organizationId: string }>("switchCompany", "POST", { organizationId: companyId });
    if (result.organizationId !== companyId) throw new MobileError("INVALID_RESPONSE", "El servidor no confirmó la empresa seleccionada.");
    const session = await this.session();
    if (session.activeCompanyId !== companyId) throw new MobileError("INVALID_RESPONSE", "La empresa activa no coincide con la selección.");
    return session;
  }
  async calendar(from: string, to: string): Promise<CalendarResult> {
    const generation = this.generation;
    const entries = new Map<string, MobileEvent>();
    const seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await this.request<WireCalendar>("calendar", "GET", undefined, { from, to, limit: "100", ...(after ? { after } : {}) });
      if (generation !== this.generation) throw new MobileError("STALE_CONTEXT", "La empresa activa cambió.");
      if (result.timeZone !== "America/Asuncion" || !Array.isArray(result.events) || !Array.isArray(result.items) || !result.page) throw new MobileError("INVALID_RESPONSE", "Calendario móvil inválido.");
      const events = new Map(result.events.map(event => [event.id, event]));
      for (const item of result.items) {
        const event = events.get(item.eventId);
        if (!event) throw new MobileError("INVALID_RESPONSE", "Item sin evento en la página de calendario.");
        const prefix = item.kind === "setup" ? "Montaje · " : item.kind === "strike" ? "Desmontaje · " : "";
        entries.set(item.id, { ...eventView(event), id: item.id, eventId: event.id, kind: item.kind, name: prefix + event.name, startsAt: item.at, endsAt: item.endAt });
      }
      if (!result.page.hasMore) return { events: [...entries.values()], timeZone: result.timeZone, truncated: false };
      after = result.page.nextAfter ?? undefined;
      if (!after || seen.has(after)) throw new MobileError("INVALID_RESPONSE", "Paginación de calendario inválida.");
      seen.add(after);
    }
    return { events: [...entries.values()], timeZone: "America/Asuncion", truncated: true };
  }
  async event(id: string): Promise<{ event: EventDetail }> {
    const generation = this.generation;
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const result = await this.request<WireEvents>("events", "GET", undefined, { limit: "100", ...(after ? { after } : {}) });
      if (generation !== this.generation) throw new MobileError("STALE_CONTEXT", "La empresa activa cambió.");
      const event = result.events.find(value => value.id === id);
      if (event) return { event: { ...eventView(event), setupAt: event.setupAt, strikeAt: event.strikeAt, notes: null, address: null, responsibleName: null } };
      if (!result.page.hasMore) throw new MobileError("HTTP", "El evento no está disponible en esta empresa.", 404);
      after = result.page.nextAfter ?? undefined;
      if (!after || seen.has(after)) throw new MobileError("INVALID_RESPONSE", "Paginación de eventos inválida.");
      seen.add(after);
    }
    throw new MobileError("HTTP", "No se encontró el evento dentro del límite de consulta.");
  }
  async profile(): Promise<Profile> {
    const session = await this.session();
    return { ...session.user, privacyUrl: this.privacyUrl, deletionAvailable: Boolean(this.contract.routes.deleteAccount) };
  }
  async logout() {
    const result = await this.request<{ loggedOut: boolean }>("logout", "POST");
    if (result.loggedOut !== true) throw new MobileError("INVALID_RESPONSE", "El servidor no confirmó la revocación.");
    await this.clearSession();
  }
  async deleteAccount(password: string) {
    const result = await this.request<{ deleted: boolean; retained: string[] }>("deleteAccount", "DELETE", { password, confirmation: "DELETE_ACCOUNT" });
    if (result.deleted !== true || !Array.isArray(result.retained)) throw new MobileError("INVALID_RESPONSE", "El servidor no confirmó la eliminación.");
    await this.clearSession();
    return { status: "DELETED", message: "Tu cuenta fue eliminada. Se conservan los registros empresariales, financieros, documentos firmados e historial de auditoría." } satisfies DeletionResult;
  }
}
