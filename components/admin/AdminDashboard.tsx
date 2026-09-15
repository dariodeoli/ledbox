"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminError, AdminFrame, AdminSpinner } from "./AdminFrame";

type User = { id: string; name: string; email: string; role: string };
type Lead = { id: string; name: string; phone: string; email: string; company: string | null; ruc: string | null; reason: string | null; eventDate: string | null; location: string | null; message: string | null; source: string; status: "NEW" | "CONTACTED" | "QUOTED" | "WON" | "LOST"; createdAt: string; quoteRequests?: Array<{ id: string; createdAt: string; items?: unknown[] }> };
type StatusFilter = "ALL" | Lead["status"];

const STATUS_LABELS: Record<StatusFilter, string> = { ALL: "Todos", NEW: "Nuevos", CONTACTED: "Contactados", QUOTED: "Cotizados", WON: "Ganados", LOST: "Perdidos" };

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-PY", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function whatsappHref(phone: string, name: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hola ${name}, te contactamos desde LedBox por tu consulta.`)}`;
}

export function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sessionResponse = await fetch("/api/admin/session", { cache: "no-store" });
      if (sessionResponse.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!sessionResponse.ok) throw new Error("session");
      const session = await sessionResponse.json() as { user?: User };
      if (!session.user) {
        router.replace("/admin/login");
        return;
      }
      setUser(session.user);
      const leadsResponse = await fetch("/api/leads", { cache: "no-store" });
      if (leadsResponse.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!leadsResponse.ok) throw new Error("leads");
      const data = await leadsResponse.json() as { leads?: Lead[] };
      setLeads(data.leads || []);
    } catch {
      setError("No pudimos cargar los leads. Revisá la conexión y probá nuevamente.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  async function logout() {
    setLoggingOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.replace("/admin/login"); router.refresh(); }
  }

  const filteredLeads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesStatus = filter === "ALL" || lead.status === filter;
      const searchable = [lead.name, lead.email, lead.phone, lead.company, lead.ruc, lead.reason, lead.location].filter(Boolean).join(" ").toLowerCase();
      return matchesStatus && (!normalized || searchable.includes(normalized));
    });
  }, [filter, leads, query]);

  const newCount = leads.filter((lead) => lead.status === "NEW").length;
  const quotedCount = leads.filter((lead) => lead.status === "QUOTED").length;

  return <AdminFrame eyebrow="LedBox · Leads & cotizaciones">
    <div className="admin-dashboard">
      <header className="admin-dashboard-head">
        <div><span className="admin-card-index">Workspace / overview</span><h1 className="admin-title admin-title--dashboard">Consultas<br /><span>recibidas.</span></h1><p className="admin-lede">{user ? <>Hola, {user.name}. Este es el pulso comercial de LedBox.</> : "Cargando tu espacio privado…"}</p></div>
        <div className="admin-dashboard-actions"><Link href="/" className="admin-ghost-button">Ver sitio ↗</Link><button type="button" className="admin-ghost-button" onClick={logout} disabled={loggingOut}>{loggingOut ? "Saliendo…" : "Cerrar sesión"}</button></div>
      </header>
      {error && <div className="admin-dashboard-message"><AdminError message={error} /><button type="button" className="admin-retry" onClick={() => void loadDashboard()}>Reintentar</button></div>}
      <section className="admin-stats" aria-label="Resumen de leads"><div className="admin-stat"><span>Total</span><strong>{loading ? "—" : leads.length}</strong><small>consultas registradas</small></div><div className="admin-stat admin-stat--active"><span>Nuevos</span><strong>{loading ? "—" : newCount}</strong><small>requieren seguimiento</small></div><div className="admin-stat"><span>Cotizados</span><strong>{loading ? "—" : quotedCount}</strong><small>con propuesta enviada</small></div></section>
      <section className="admin-leads-section" aria-labelledby="leads-title"><div className="admin-section-heading"><div><span className="admin-card-index">Inbox / {filteredLeads.length}</span><h2 id="leads-title">Leads recientes</h2></div><div className="admin-filters"><label className="sr-only" htmlFor="lead-search">Buscar leads</label><input id="lead-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar…" /><label className="sr-only" htmlFor="lead-status">Filtrar por estado</label><select id="lead-status" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
        {loading ? <div className="admin-loading-panel"><AdminSpinner label="Cargando leads" /><span>Cargando consultas…</span></div> : filteredLeads.length === 0 ? <div className="admin-empty"><span className="admin-empty-icon">∅</span><h3>{leads.length === 0 ? "Todavía no hay consultas." : "No hay coincidencias."}</h3><p>{leads.length === 0 ? "Cuando alguien complete el formulario, su consulta aparecerá acá." : "Probá con otro texto o estado."}</p></div> : <div className="admin-lead-list">{filteredLeads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}</div>}
      </section>
      <p className="admin-dashboard-note">Los precios y datos de cada consulta se guardan como referencia. Confirmá disponibilidad, fechas y alcance antes de enviar una propuesta final.</p>
    </div>
  </AdminFrame>;
}

function LeadRow({ lead }: { lead: Lead }) {
  return <article className="admin-lead-row"><div className="admin-lead-main"><div className="admin-lead-meta"><span className={`admin-status admin-status--${lead.status.toLowerCase()}`}>{STATUS_LABELS[lead.status]}</span><time dateTime={lead.createdAt}>{formatDate(lead.createdAt)}</time></div><h3>{lead.name}</h3><p className="admin-lead-contact"><a href={`mailto:${lead.email}`}>{lead.email}</a><span>·</span><a href={`tel:${lead.phone}`}>{lead.phone}</a>{lead.company && <><span>·</span><span>{lead.company}</span></>}</p>{(lead.reason || lead.location || lead.eventDate) && <p className="admin-lead-context">{[lead.reason, lead.location, lead.eventDate && `Evento: ${formatDate(lead.eventDate)}`].filter(Boolean).join(" · ")}</p>}{lead.message && <p className="admin-lead-message">{lead.message}</p>}</div><div className="admin-lead-actions"><a href={whatsappHref(lead.phone, lead.name)} target="_blank" rel="noopener noreferrer" className="admin-action admin-action--primary">WhatsApp ↗</a><a href={`mailto:${lead.email}?subject=${encodeURIComponent("Tu consulta para LedBox")}`} className="admin-action">Email</a></div></article>;
}
