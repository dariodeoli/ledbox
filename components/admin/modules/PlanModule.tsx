"use client";

import { useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { canManageOrganization } from "@/lib/admin-policy";
import { formatDate, formatMoney, formatNumber, planRequestStatusLabel, planRequestStatusTone } from "@/lib/admin-format";
import { planLimitLabel } from "@/lib/plan-rules";
import type { AdminPlanPayload, AdminPlanRequestRow, AdminPlanRow, AdminPlanUsage } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { TextAreaField } from "../AdminFields";
import {
  AdminBadge,
  AdminButton,
  AdminDataState,
  AdminDialog,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminCell,
  AdminTable,
} from "../AdminUI";

/**
 * Plan de la empresa (issue #42): plan vigente, consumo real del mes, comparación
 * del catálogo y solicitud de cambio auditada.
 *
 * - Se ve en todos los roles (el consumo y los topes son información de la
 *   empresa); solo OWNER/ADMIN piden el cambio (`org.manage` en el API).
 * - **Todavía no hay pasarela de pago**: la solicitud queda registrada y el
 *   cambio efectivo lo hace Owncoding. La UI lo dice en el lugar de la acción.
 * - La demo es de solo lectura: el plan Pro se ve, no se cambia.
 */

const EMPTY_PLAN: AdminPlanPayload = {
  plan: null,
  planStartedAt: null,
  catalog: [],
  usage: null,
  pendingRequest: null,
  requests: [],
};

/** Nota del cupo de usuarios: las invitaciones pendientes ocupan lugar. */
function usersUsageNote(usage: AdminPlanUsage): string {
  const pending = usage.users.pendingInvitations;
  if (pending === 0) return "Cuentan las membresías activas del equipo.";
  return `Incluye ${formatNumber(pending)} ${pending === 1 ? "invitación pendiente" : "invitaciones pendientes"}: reservan un lugar hasta que venzan o se acepten.`;
}

/** Nota del cupo de eventos: es el cupo de altas del mes, no un filtro de datos. */
const eventsUsageNote = "Eventos creados en el mes; los ya cargados no se ocultan.";

/** Fila de consumo con su barra: usada y tope salen del API, nunca se inventan. */
function UsageRow({
  label,
  used,
  limit,
  percent,
  level,
  note,
}: {
  label: string;
  used: number;
  limit: number | null;
  percent: number | null;
  level: AdminPlanUsage["users"]["level"];
  note: string;
}) {
  return (
    <div className="admin-plan-usage-row" data-level={level}>
      <div className="admin-plan-usage-head">
        <span className="admin-plan-usage-label">{label}</span>
        <strong className="admin-plan-usage-value">
          {formatNumber(used)}
          <span className="admin-plan-usage-limit">{limit === null ? " · sin tope" : ` de ${formatNumber(limit)}`}</span>
        </strong>
      </div>
      <span
        className="admin-plan-meter"
        role="progressbar"
        aria-label={`${label}: ${formatNumber(used)} de ${planLimitLabel(limit)}`}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={limit === null ? undefined : used}
        aria-valuetext={limit === null ? `${formatNumber(used)} · sin tope` : `${formatNumber(used)} de ${formatNumber(limit)}`}
      >
        <span className="admin-plan-meter-fill" style={{ width: `${percent ?? 0}%` }} />
      </span>
      <p className="admin-plan-usage-note">{note}</p>
    </div>
  );
}

/** Diálogo de solicitud: nota corta y confirmación propia (nunca confirm nativo). */
function PlanRequestDialog({
  plan,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  plan: AdminPlanRow;
  busy: boolean;
  error: string;
  onSubmit: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <AdminDialog title={`Solicitar el plan ${plan.name}`} icon="plan" onClose={onClose}>
      <p className="admin-dialog-text">
        La solicitud queda registrada con tu usuario y el equipo de Owncoding aplica el cambio.{" "}
        <strong>Todavía no hay pasarela de pago</strong>: el cobro del plan se coordina aparte.
      </p>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(note.trim());
        }}
        noValidate
      >
        <TextAreaField
          label="Nota para el equipo (opcional)"
          rows={3}
          maxLength={400}
          value={note}
          onChange={setNote}
          placeholder="Ej.: necesitamos sumar 4 usuarios y facturar a 30 días."
          hint="Máximo 400 caracteres."
        />
        {error ? <AdminNote tone="error">{error}</AdminNote> : null}
        <div className="admin-dialog-foot">
          <span className="admin-dialog-spacer" />
          <AdminButton icon="close" type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" variant="primary" icon="check" busy={busy}>
            Enviar solicitud
          </AdminButton>
        </div>
      </form>
    </AdminDialog>
  );
}

export function PlanModule() {
  const { role, demo } = useAdminSession();
  const resource = useAdminResource<AdminPlanPayload>("/api/admin/plan", (payload) => ({
    plan: payload.plan ?? null,
    planStartedAt: payload.planStartedAt ?? null,
    catalog: payload.catalog ?? [],
    usage: payload.usage ?? null,
    pendingRequest: payload.pendingRequest ?? null,
    requests: payload.requests ?? [],
  }));
  const data = resource.data ?? EMPTY_PLAN;
  const plan = data.plan;
  const usage = data.usage;
  const canRequest = canManageOrganization(role) && !demo;

  const [requesting, setRequesting] = useState<AdminPlanRow | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState("");

  async function submitRequest(note: string) {
    if (!requesting) return;
    setRequestBusy(true);
    setRequestError("");
    const result = await adminSend("/api/admin/plan/requests", { planId: requesting.id, note: note || undefined });
    setRequestBusy(false);
    if (!result.ok) {
      setRequestError(result.error);
      return;
    }
    setNotice(
      `Solicitud registrada: pediste el plan «${requesting.name}». Queda en auditoría y el cambio lo aplica Owncoding.`,
    );
    setNoticeError("");
    setRequesting(null);
    resource.reload();
  }

  const usageWarn =
    usage && ((usage.users.limit !== null && usage.users.used >= usage.users.limit) || (usage.events.limit !== null && usage.events.used >= usage.events.limit));

  return (
    <div className="admin-module-page">
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {noticeError ? <AdminNote tone="error">{noticeError}</AdminNote> : null}

      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={4}>
        <AdminPanel
          title="Plan actual" icon="plan"
          meta={data.planStartedAt ? `Inicio del plan: ${formatDate(data.planStartedAt)}` : undefined}
          action={plan ? <AdminBadge tone="accent">{plan.code}</AdminBadge> : undefined}
        >
          {plan ? (
            <div className="admin-settings">
              <div className="admin-settings-grid">
                <div className="admin-settings-readonly">
                  <span className="admin-field-label">Plan</span>
                  <p className="admin-detail-value">{plan.name}</p>
                  <span className="admin-field-hint">{plan.description ?? "Sin descripción."}</span>
                </div>
                <AdminKpi
                  label="Precio mensual" icon="finance"
                  value={plan.priceMonthly === 0 ? "Sin costo" : `${formatMoney(plan.priceMonthly)} / mes`}
                  note="El cobro se coordina con Owncoding: todavía no hay pasarela de pago."
                />
              </div>
              <div className="admin-kpis">
                <AdminKpi
                  label="Usuarios del plan" icon="users"
                  value={planLimitLabel(plan.maxUsers)}
                  note={plan.maxUsers === null ? "Sin tope de usuarios." : "Membresías activas e invitaciones pendientes."}
                />
                <AdminKpi
                  label="Eventos por mes" icon="events"
                  value={planLimitLabel(plan.maxEventsPerMonth)}
                  note={plan.maxEventsPerMonth === null ? "Sin tope de eventos." : "Eventos creados por mes calendario."}
                />
                <AdminKpi label="Consumo de usuarios" icon="overview" value={usage ? `${formatNumber(usage.users.used)} / ${planLimitLabel(usage.users.limit)}` : "—"} />
                <AdminKpi
                  label={usage ? `Eventos · ${usage.events.periodLabel}` : "Eventos del mes"} icon="events"
                  value={usage ? `${formatNumber(usage.events.used)} / ${planLimitLabel(usage.events.limit)}` : "—"}
                />
              </div>
            </div>
          ) : (
            <AdminNote>La empresa todavía no tiene un plan asignado. Se asigna el plan por defecto al guardar o pedirlo desde acá.</AdminNote>
          )}
        </AdminPanel>

        {usage ? (
          <AdminPanel title="Consumo del mes" icon="overview" meta={usage.events.periodLabel}>
            {usageWarn ? (
              <AdminNote tone="error">
                La empresa está en el tope del plan: las altas nuevas se rechazan con el aviso del plan y no se borra nada de lo
                cargado.
              </AdminNote>
            ) : null}
            <div className="admin-plan-usage">
              <UsageRow
                label="Usuarios e invitaciones"
                used={usage.users.used}
                limit={usage.users.limit}
                percent={usage.users.percent}
                level={usage.users.level}
                note={usersUsageNote(usage)}
              />
              <UsageRow
                label={`Eventos creados · ${usage.events.periodLabel}`}
                used={usage.events.used}
                limit={usage.events.limit}
                percent={usage.events.percent}
                level={usage.events.level}
                note={eventsUsageNote}
              />
            </div>
          </AdminPanel>
        ) : null}

        {data.pendingRequest ? (
          <AdminNote>
            Solicitud pendiente: plan «{data.pendingRequest.planName}» pedida por {data.pendingRequest.requestedByName} el{" "}
            {formatDate(data.pendingRequest.createdAt)}. El cambio efectivo lo aplica Owncoding; podés cambiarla pidiendo otro plan.
          </AdminNote>
        ) : null}

        <AdminPanel
          title="Planes" icon="plan"
          meta="Comparación del catálogo · sin pasarela de pago: el cambio lo aplica Owncoding"
        >
          {data.catalog.length === 0 ? (
            <AdminNote>El catálogo de planes está vacío. Avisá al equipo de Owncoding.</AdminNote>
          ) : (
            <div className="admin-plans">
              {data.catalog.map((candidate) => {
                const current = plan?.id === candidate.id;
                const requested = data.pendingRequest?.planId === candidate.id;
                return (
                  <article className="admin-plan-card" key={candidate.id} data-current={current || undefined}>
                    <header className="admin-plan-card-head">
                      <h3 className="admin-plan-card-name">{candidate.name}</h3>
                      {current ? <AdminBadge tone="ok">Plan actual</AdminBadge> : null}
                      {requested ? <AdminBadge tone="warn">Solicitud pendiente</AdminBadge> : null}
                    </header>
                    <p className="admin-plan-card-price">
                      <strong>{candidate.priceMonthly === 0 ? "Sin costo" : formatMoney(candidate.priceMonthly)}</strong>
                      <span>{candidate.priceMonthly === 0 ? "plan de entrada" : "por mes"}</span>
                    </p>
                    <dl className="admin-facts">
                      <div>
                        <dt>Usuarios</dt>
                        <dd>{planLimitLabel(candidate.maxUsers)}</dd>
                      </div>
                      <div>
                        <dt>Eventos por mes</dt>
                        <dd>{planLimitLabel(candidate.maxEventsPerMonth)}</dd>
                      </div>
                    </dl>
                    <ul className="admin-plan-card-features">
                      {candidate.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                    <footer className="admin-plan-card-foot">
                      {current ? (
                        <span className="admin-field-hint">La empresa ya está en este plan.</span>
                      ) : canRequest && !requested ? (
                        <AdminButton
                          icon="arrow-right"
                          title={`Solicitar el plan ${candidate.name}`}
                          onClick={() => {
                            setRequestError("");
                            setNotice("");
                            setNoticeError("");
                            setRequesting(candidate);
                          }}
                        >
                          Solicitar este plan
                        </AdminButton>
                      ) : requested ? (
                        <span className="admin-field-hint">Ya pediste este plan: esperá la aplicación de Owncoding.</span>
                      ) : (
                        <span className="admin-field-hint">Solo OWNER/ADMIN pueden pedir el cambio.</span>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </AdminPanel>

        <AdminPanel title="Solicitudes de cambio" icon="mail" meta="Historial auditado">
          <AdminDataState
            empty={data.requests.length === 0 && !data.pendingRequest}
            emptyTitle="Sin solicitudes" emptyIcon="mail"
            emptyHint="Cuando se pida un cambio de plan, queda registrado acá con quién lo pidió."
          >
            <AdminTable
              view="plan-solicitudes"
              label="Solicitudes de cambio de plan"
              columns={[
                { label: "Fecha" },
                { label: "Plan" },
                { label: "Estado" },
                { label: "Pidió" },
                { label: "Nota", end: true },
              ]}
            >
              {[
                ...(data.pendingRequest ? [data.pendingRequest] : []),
                ...data.requests,
              ].map((entry: AdminPlanRequestRow) => (
                <AdminRow key={entry.id}>
                  <AdminCell title={`Pedida el ${formatDate(entry.createdAt)}`}>
                    <span className="admin-nowrap">{formatDate(entry.createdAt)}</span>
                  </AdminCell>
                  <AdminCell title={entry.planCode}>{entry.planName}</AdminCell>
                  <AdminCell>
                    <AdminBadge tone={planRequestStatusTone(entry.status)}>{planRequestStatusLabel(entry.status)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={entry.requestedByEmail ?? undefined}>
                    <span className="admin-nowrap">{entry.requestedByName}</span>
                  </AdminCell>
                  <AdminCell
                    title={entry.decidedByName ? `Resuelta por ${entry.decidedByName}` : entry.note ?? undefined}
                  >
                    {entry.decidedByName ? `Resuelta por ${entry.decidedByName}` : entry.note ?? "—"}
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          </AdminDataState>
        </AdminPanel>
      </AdminDataState>

      {requesting ? (
        <PlanRequestDialog
          plan={requesting}
          busy={requestBusy}
          error={requestError}
          onSubmit={(note) => void submitRequest(note)}
          onClose={() => setRequesting(null)}
        />
      ) : null}
    </div>
  );
}
