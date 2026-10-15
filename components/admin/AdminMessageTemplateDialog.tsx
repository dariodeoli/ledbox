"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { isWhatsappSandbox, whatsappHref } from "@/lib/admin-format";
import { SIMULATED_WHATSAPP_NOTICE } from "@/lib/mail-preview";
import { MESSAGE_TEMPLATE_TARGET_CATEGORIES, type AdminMessageTemplateRow } from "@/lib/admin-types";
import { AdminButton, AdminDialog, AdminDialogSection, AdminEmpty, AdminLoadingRows, AdminNote } from "./AdminUI";
import { SelectField } from "./AdminFields";
import { WhatsappIcon } from "../whatsapp/WhatsappIcon";

/**
 * Envío por WhatsApp con plantilla (issue #35), compartido por Presupuestos,
 * Eventos, Clientes y Finanzas.
 *
 * El diálogo lista las plantillas **activas** de la categoría del contexto
 * (presupuesto, evento, cliente o cobranza), pide al servidor el render con los
 * datos reales (`POST /api/admin/message-templates/send` con `preview`) y abre
 * `wa.me` con el mensaje ya completo. Si falta un dato, el servidor devuelve el
 * error y acá no se habilita el envío: nunca sale un `{{...}}` visible.
 *
 * El envío queda registrado (auditoría del actor y, en cobros, el historial de
 * `PaymentReminderLog`); por eso el diálogo avisa «queda registrado» y no
 * «entregado»: la entrega la confirma el equipo en WhatsApp.
 */

export type MessageTemplateTarget = {
  kind: keyof typeof MESSAGE_TEMPLATE_TARGET_CATEGORIES;
  id: string;
  /** Texto visible del destinatario (cliente, empresa o presupuesto). */
  label: string;
  /** Teléfono real del contacto; sin él el módulo no dibuja la acción. */
  phone: string | null;
};

type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; message: string; phone: string | null }
  | { status: "error"; error: string };

export function MessageTemplateSendDialog({
  target,
  onClose,
  onRegistered,
}: {
  target: MessageTemplateTarget;
  onClose: () => void;
  /** Avisa que el envío quedó registrado (Finanzas recarga el historial del cobro). */
  onRegistered?: () => void;
}) {
  const templatesResource = useAdminResource("/api/admin/message-templates", (payload) => payload.templates ?? []);
  const category = MESSAGE_TEMPLATE_TARGET_CATEGORIES[target.kind];
  const templates = useMemo<AdminMessageTemplateRow[]>(
    () => (templatesResource.data ?? []).filter((template) => template.category === category && template.active),
    [templatesResource.data, category],
  );

  const [templateId, setTemplateId] = useState("");
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  const [registerError, setRegisterError] = useState("");
  /** `null` sin registrar; `already` cuando el cobro ya tenía un WhatsApp hoy. */
  const [registered, setRegistered] = useState<"new" | "already" | null>(null);

  // Plantilla por defecto: la primera activa de la categoría.
  useEffect(() => {
    if (templateId || templates.length === 0) return;
    setTemplateId(templates[0].id);
  }, [templates, templateId]);

  // Vista previa real: la arma el servidor con los datos del destinatario.
  useEffect(() => {
    if (!templateId) {
      setPreview({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading" });
    setRegisterError("");
    setRegistered(null);
    void (async () => {
      const result = await adminSend<{ message: string; phone: string | null }>(
        "/api/admin/message-templates/send",
        { templateId, target: { kind: target.kind, id: target.id }, preview: true },
      );
      if (cancelled) return;
      setPreview(
        result.ok
          ? { status: "ready", message: result.data.message, phone: result.data.phone }
          : { status: "error", error: result.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, target.kind, target.id]);

  const href = preview.status === "ready" ? whatsappHref(preview.phone, preview.message) : null;
  // Demo: no se abre wa.me; el envío se simula (queda registrado) y el texto se muestra tal cual.
  const sandbox = isWhatsappSandbox();
  const simulatedReady = sandbox && preview.status === "ready" && Boolean(preview.phone);

  /** Registra el envío (no bloquea la apertura de WhatsApp). */
  const register = useCallback(() => {
    if (!templateId) return;
    setRegisterError("");
    void (async () => {
      const result = await adminSend<{ alreadyToday?: boolean }>("/api/admin/message-templates/send", {
        templateId,
        target: { kind: target.kind, id: target.id },
      });
      if (!result.ok) {
        setRegisterError(result.error);
        return;
      }
      setRegistered(result.data.alreadyToday ? "already" : "new");
      onRegistered?.();
    })();
  }, [templateId, target.kind, target.id, onRegistered]);

  const selected = templates.find((template) => template.id === templateId);

  return (
    <AdminDialog
      title={`Enviar por WhatsApp · ${target.label}`}
      size="md"
      icon="mail"
      description={`Elegí una plantilla: el mensaje se completa con los datos reales de ${target.label} y se abre en WhatsApp listo para enviar.`}
      error={registerError || (preview.status === "error" ? preview.error : "") || (preview.status === "ready" && !href && !simulatedReady ? "El cliente no tiene teléfono cargado." : "")}
      onClose={onClose}
      footer={<>
      <AdminButton icon="close" type="button" onClick={onClose}>Cerrar</AdminButton>
      {simulatedReady ? (
        <AdminButton variant="primary" type="button" iconNode={<WhatsappIcon size={15} />} onClick={register} disabled={Boolean(registered)}>
          {registered ? "Envío simulado" : "Simular envío"}
        </AdminButton>
      ) : href ? (
        <a
          className="admin-btn admin-btn--primary"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`Enviar por WhatsApp a ${target.label}`}
          onClick={register}
        >
          <WhatsappIcon size={15} />
          <span>Enviar por WhatsApp</span>
        </a>
      ) : (
        <AdminButton variant="primary" type="button" iconNode={<WhatsappIcon size={15} />} disabled>
          Enviar por WhatsApp
        </AdminButton>
      )}
    </>}>
      <AdminDialogSection title="Plantilla" stack>
      {templatesResource.loading ? (
        <AdminLoadingRows rows={3} />
      ) : templatesResource.error ? (
        <AdminNote tone="error">{templatesResource.error}</AdminNote>
      ) : templates.length === 0 ? (
        <AdminEmpty
          icon="mail"
          title="Sin plantillas activas para este contexto"
          hint="Cargá o activá una plantilla de esta categoría en Plantillas y volvé a intentar."
        />
      ) : (
        <SelectField
          label="Plantilla"
          value={templateId}
          onChange={setTemplateId}
          options={templates.map((template) => ({ value: template.id, label: template.title }))}
        />
      )}

      {templates.length === 0 && !templatesResource.loading ? (
        <div className="admin-dialog-actions">
          <Link className="admin-linkbtn" href="/plantillas">
            Ir a Plantillas
          </Link>
        </div>
      ) : null}
      </AdminDialogSection>

      {preview.status === "loading" || preview.status === "ready" ? (
        <AdminDialogSection title={sandbox ? SIMULATED_WHATSAPP_NOTICE : "Vista previa"} stack>
          {preview.status === "loading" ? <p className="admin-dialog-text">Armando el mensaje con los datos reales…</p> : null}
          {preview.status === "ready" ? <pre className="admin-message-preview">{preview.message}</pre> : null}
        </AdminDialogSection>
      ) : null}

      {registered && !registerError && sandbox ? (
        <AdminNote tone="ok">
          Demo: no se abrió WhatsApp ni salió ningún mensaje. {SIMULATED_WHATSAPP_NOTICE}: es el texto de arriba. El envío simulado quedó registrado.
        </AdminNote>
      ) : null}

      {registered && !registerError && !sandbox ? (
        <AdminNote tone="ok">
          {registered === "already"
            ? `WhatsApp abierto con «${selected?.title ?? "la plantilla"}». Este cobro ya tenía un WhatsApp registrado hoy: no se duplica.`
            : `WhatsApp abierto con «${selected?.title ?? "la plantilla"}». El envío quedó registrado en la auditoría.`}
        </AdminNote>
      ) : null}

    </AdminDialog>
  );
}
