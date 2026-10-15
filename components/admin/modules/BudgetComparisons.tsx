"use client";
import { useMemo, useState } from "react";
import type { AdminBudgetRow } from "@/lib/admin-types";
import { useAdminResource } from "@/lib/admin-api";
import { comparisonPortalUrl } from "@/lib/public-config";
import { TextField, DateField, SwitchField } from "../AdminFields";
import { AdminButton, AdminDialog, AdminNote } from "../AdminUI";
import { quoteComparisonEligible } from "@/lib/quote-sharing";
import { formatDate, todayDayKey } from "@/lib/admin-format";

type Group = { id: string; title: string; publicToken: string; expiresAt: string; revokedAt: string | null; selectedBudgetId: string | null; budgets: Array<{ id: string; title: string; comparisonLabel: string }> };
export function BudgetComparisons({ quotes }: { quotes: AdminBudgetRow[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [expiresAt, setExpiresAt] = useState(todayDayKey(new Date(Date.now() + 7 * 86400000)));
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const groups = useAdminResource("/api/admin/budgets/comparisons", (data) => ((data as unknown as { groups?: Group[] }).groups ?? []));
  const ids = Object.keys(chosen);
  const clientId = quotes.find((q) => q.id === ids[0])?.client.id;
  const candidates = useMemo(() => quotes.filter((q) => quoteComparisonEligible(q) && (!clientId || q.client.id === clientId) && !(groups.data ?? []).some((g) => g.budgets.some((b) => b.id === q.id))), [quotes, clientId, groups.data]);
  function url(group: Group) { return comparisonPortalUrl(group.publicToken); }
  async function mutate(body: unknown, method: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/budgets/comparisons", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error || "No pudimos guardar la comparación."); return; }
      groups.reload(); setChosen({}); setTitle(""); setMessage(method === "POST" ? "Comparación creada. Copiá el enlace cuando decidas compartirlo." : (body as { action: string }).action === "renew" ? "Enlace renovado por 7 días. El enlace anterior dejó de funcionar." : "Enlace revocado.");
    } catch { setMessage("No pudimos conectar. Intentá nuevamente."); }
    finally { setBusy(false); }
  }
  return <>
    <AdminButton icon="budgets" onClick={() => setOpen(true)}>Comparar alternativas</AdminButton>
    {open ? <AdminDialog title="Comparaciones opcionales" onClose={() => setOpen(false)}>
      <p className="admin-dialog-text">Elegí de 2 a 4 presupuestos vigentes del mismo cliente. Solo se podrá aprobar una alternativa, también desde sus enlaces individuales o firmas. Crear el enlace no envía mensajes ni cambia los estados.</p>
      {groups.loading ? <p>Cargando comparaciones…</p> : null}
      {groups.error ? <AdminNote tone="error">{groups.error}</AdminNote> : null}
      {(groups.data ?? []).map((group) => {
        const inactive = Boolean(group.revokedAt) || new Date(group.expiresAt) <= new Date();
        return <section key={group.id} className="admin-comparison-existing"><strong>{group.title}</strong><p>{group.budgets.map((q) => q.comparisonLabel).join(" · ")} · {inactive ? "Enlace no vigente" : group.selectedBudgetId ? "Alternativa elegida" : `Vence ${formatDate(group.expiresAt)}`}</p>
          <div className="admin-actions">
            <AdminButton disabled={inactive} onClick={() => { void navigator.clipboard.writeText(url(group)).then(() => setMessage("Enlace copiado.")).catch(() => setMessage("No pudimos copiar el enlace. Usá Ver como cliente.")); }}>Copiar enlace de comparación</AdminButton>
            <AdminButton disabled={inactive} onClick={() => window.open(url(group), "_blank", "noopener,noreferrer")}>Ver comparación como cliente</AdminButton>
            <AdminButton disabled={busy} onClick={() => void mutate({ id: group.id, action: "renew" }, "PATCH")}>Renovar enlace (7 días)</AdminButton>
            <AdminButton disabled={busy || inactive} onClick={() => void mutate({ id: group.id, action: "revoke" }, "PATCH")}>Revocar enlace</AdminButton>
          </div></section>;
      })}
      {!groups.loading && !groups.data?.length ? <p>No hay comparaciones creadas.</p> : null}
      <h3>Nueva comparación</h3>
      <TextField label="Nombre de la comparación" value={title} maxLength={120} required onChange={setTitle} />
      <DateField label="Vencimiento de la comparación" value={expiresAt} required onChange={setExpiresAt} />
      <div className="admin-comparison-candidates">
        {candidates.map((quote) => <div key={quote.id}>
          <SwitchField label={`Incluir ${quote.title}`} hint={quote.client.company || quote.client.name} checked={Object.hasOwn(chosen, quote.id)} disabled={busy || (!Object.hasOwn(chosen, quote.id) && ids.length >= 4)} onChange={(checked) => setChosen((rows) => { const next = { ...rows }; if (checked) next[quote.id] = quote.title.slice(0,80); else delete next[quote.id]; return next; })} />
          {Object.hasOwn(chosen, quote.id) ? <TextField label={`Nombre de alternativa: ${quote.title}`} value={chosen[quote.id]} maxLength={80} required onChange={(value) => setChosen((rows) => ({ ...rows, [quote.id]: value }))} /> : null}
        </div>)}
      </div>
      {!candidates.length ? <p>No hay presupuestos elegibles para una nueva comparación.</p> : null}
      <AdminButton variant="primary" disabled={busy || ids.length < 2 || !title.trim() || !expiresAt} onClick={() => void mutate({ title, expiresAt: `${expiresAt}T23:59:59-03:00`, alternatives: ids.map((budgetId) => ({ budgetId, label: chosen[budgetId] })) }, "POST")}>{busy ? "Guardando…" : "Crear comparación"}</AdminButton>
      {message ? <p role="status">{message}</p> : null}
    </AdminDialog> : null}
  </>;
}
