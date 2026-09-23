"use client";

import { useMemo, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime, mailCategoryLabel, mailStatusLabel, mailStatusTone } from "@/lib/admin-format";
import type { AdminMailConfig, AdminMailLogRow } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminBadge, AdminButton, AdminCell, AdminDataState, AdminNote, AdminPanel, AdminRow, AdminTable } from "../AdminUI";
import { AdminIcon } from "../AdminIcons";

/**
 * Correo (issue #30): remitente, clave del proveedor, prueba e historial de
 * envíos de la empresa. Es la sección **Correo** de Ajustes (issue #56): la
 * subnavegación y el resto de las secciones viven en `AjustesModule`.
 * Es OWNER/ADMIN: la API responde 403 al resto de los roles.
 */

type TestOutcome = {
  status: "sent" | "failed" | "skipped" | string;
  error: string | null;
  to: string;
};

export function CorreoModule() {
  const { user } = useAdminSession();
  const resource = useAdminResource("/api/admin/mail", (payload) => ({
    config: (payload.mail ?? null) as AdminMailConfig | null,
    history: (payload.history ?? []) as AdminMailLogRow[],
  }));
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<TestOutcome | null>(null);

  const config = resource.data?.config ?? null;
  const history = useMemo(() => resource.data?.history ?? [], [resource.data]);

  async function sendTest() {
    setTestBusy(true);
    setTestError("");
    setTestResult(null);
    const result = await adminSend<TestOutcome>("/api/admin/mail/test", {});
    setTestBusy(false);
    if (!result.ok) {
      setTestError(result.error);
      return;
    }
    setTestResult(result.data);
    resource.reload();
  }

  return (
    <div className="admin-module-page">
      <AdminPanel title="Correo" icon="mail" meta={config ? `${config.provider} · remitente ${config.sender}` : "Cargando…"}>
        <div className="admin-settings">
          {config && !config.configured && config.hint ? <AdminNote tone="error">{config.hint}</AdminNote> : null}
          {testResult && testResult.status === "sent" ? (
            <AdminNote tone="ok" variant="alert">
              Enviamos el correo de prueba a {testResult.to}. Revisá la bandeja (y el spam) para confirmar la entrega.
            </AdminNote>
          ) : null}
          {testResult && testResult.status !== "sent" ? (
            <AdminNote tone="error" variant="alert">
              {testResult.error ?? "El proveedor rechazó el envío."}
            </AdminNote>
          ) : null}
          {testError ? <AdminNote tone="error">{testError}</AdminNote> : null}

          <div className="admin-settings-grid">
            <div className="admin-settings-readonly">
              <span className="admin-field-label">Remitente configurado</span>
              <p className="admin-detail-value">{config?.sender ?? "—"}</p>
              <span className="admin-field-hint">Se define con EMAIL_FROM; sin él se usa el remitente de recuperación.</span>
            </div>
            <div className="admin-settings-readonly">
              <span className="admin-field-label">Clave del proveedor</span>
              <p className="admin-detail-value">
                {config ? (config.configured ? `${config.envVar}: configurada` : `${config.envVar}: falta`) : "—"}
              </p>
              <span className="admin-field-hint">
                {config?.configured
                  ? "Los correos salen por Resend con esta clave."
                  : "Cargá la clave del proveedor en el entorno del backend para habilitar los envíos."}
              </span>
            </div>
            <div className="admin-settings-readonly">
              <span className="admin-field-label">Destino de la prueba</span>
              <p className="admin-detail-value">{user?.email ?? "Tu correo de la sesión"}</p>
              <span className="admin-field-hint">La prueba se manda a tu propio correo, no a un cliente.</span>
            </div>
          </div>
          <div className="admin-settings-actions">
            <AdminButton
              icon="mail"
              busy={testBusy}
              disabled={!config?.configured}
              title={config && !config.configured ? "Falta RESEND_API_KEY: cargá la clave para probar el envío" : undefined}
              onClick={() => void sendTest()}
            >
              Enviar correo de prueba
            </AdminButton>
            <span className="admin-field-hint">
              El resultado real del proveedor queda en el historial, con el motivo del fallo si lo hubo.
            </span>
          </div>
        </div>
      </AdminPanel>

      <AdminPanel title="Historial de envíos" icon="mail" meta="Últimos 30 envíos de la empresa">
        <AdminDataState
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          empty={history.length === 0}
          emptyTitle="Todavía no hay envíos registrados" emptyIcon="mail"
          emptyHint="Cuando el panel mande un correo (prueba, presupuesto o recordatorio) vas a verlo acá con su estado real."
        >
          <AdminTable
            view="correo"
            label="Historial de envíos de correo"
            columns={[
              { label: "Fecha" },
              { label: "Destinatario" },
              { label: "Tipo" },
              { label: "Asunto" },
              { label: "Estado" },
              { label: "Motivo" },
            ]}
          >
            {history.map((log) => (
              <AdminRow key={log.id} tone={log.status === "failed" ? "danger" : undefined}>
                <AdminCell title={formatDateTime(log.sentAt)}>
                  <span className="admin-nowrap">{formatDateTime(log.sentAt)}</span>
                </AdminCell>
                <AdminCell title={log.to}>
                  {log.to}
                  {log.actorName ? <small className="admin-cell-sub"> · {log.actorName}</small> : null}
                </AdminCell>
                <AdminCell title={mailCategoryLabel(log.category)}>{mailCategoryLabel(log.category)}</AdminCell>
                <AdminCell title={log.subject}>{log.subject}</AdminCell>
                <AdminCell title={log.providerId ? `Id del proveedor: ${log.providerId}` : mailStatusLabel(log.status)}>
                  <AdminBadge tone={mailStatusTone(log.status)}>{mailStatusLabel(log.status)}</AdminBadge>
                </AdminCell>
                <AdminCell title={log.error ?? "Sin fallos"}>
                  {log.error ? <span className="admin-reminder-error">{log.error}</span> : "—"}
                </AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        </AdminDataState>
      </AdminPanel>

      <AdminNote>
        Los correos de reset, recordatorios, presupuestos e invitaciones usan la misma plantilla e identidad.
      </AdminNote>
    </div>
  );
}
