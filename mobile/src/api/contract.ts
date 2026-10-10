/** View models adapted from PF docs/CONTRATO-MOVIL-LEDBOX.md v1.
 * Contract binding is not proof of deployed endpoints or successful integration. */
export type Role = "OWNER" | "ADMIN" | "FINANCE" | "OPERATIONS" | "VIEWER";
export type User = { id: string; name: string; email: string };
export type Company = { id: string; name: string; role: Role };
export type Session = { user: User; companies: Company[]; activeCompanyId: string | null; expiresAt: string };
export type MobileEvent = {
  id: string; eventId: string; kind: "event" | "setup" | "strike"; name: string; startsAt: string | null; endsAt: string | null;
  statusLabel: string; clientName: string | null; location: string | null;
};
export type EventDetail = MobileEvent & {
  notes: string | null; address: string | null; setupAt: string | null; strikeAt: string | null;
  responsibleName: string | null;
};
export type Profile = User & { privacyUrl: string; deletionAvailable: boolean };
export type DeletionResult = { status: "DELETED" | "REQUESTED"; message: string };
export type Endpoint = "login" | "session" | "switchCompany" | "calendar" | "events" | "logout" | "deleteAccount";
export type Contract = {
  status: "PENDING_PF" | "BOUND_PF";
  version: string | null;
  routes: Partial<Record<Endpoint, string>>;
};

export const mobileContract: Contract = { status: "BOUND_PF", version: "1", routes: {
  login: "/api/mobile/login", session: "/api/mobile/me", switchCompany: "/api/mobile/active-organization",
  calendar: "/api/mobile/calendar", events: "/api/mobile/events", logout: "/api/mobile/logout", deleteAccount: "/api/mobile/account",
} };
export type WireSession = {
  version: 1; user: User; organizations: (Company & { slug: string })[];
  activeOrganization: (Company & { slug: string }) | null; capabilities: string[]; session: { expiresAt: string };
};
export type WireEvent = { id: string; name: string; status: string; location: string | null; city: string | null;
  startsAt: string | null; endsAt: string | null; setupAt: string | null; strikeAt: string | null };
export type WireEvents = { version: 1; events: WireEvent[]; page: { hasMore: boolean; nextAfter: string | null } };
export type WireCalendar = WireEvents & { from: string; to: string; timeZone: "America/Asuncion";
  items: { id: string; eventId: string; kind: "event" | "setup" | "strike"; date: string; at: string; endAt: string | null }[] };
