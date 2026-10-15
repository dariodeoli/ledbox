"use client";

import React from "react";
import { SIMULATED_MAIL_NOTICE, type SimulatedMail } from "@/lib/mail-preview";
import { AdminMailPreview } from "./AdminMailPreview";
import { AdminButton, AdminDialog, AdminNote } from "./AdminUI";

/**
 * Demo (docs/DEMO-INTERACTIVA.md §3): en una sandbox el correo no sale. Donde el panel diría «enviado»,
 * este diálogo dice que se simuló y muestra el asunto y el cuerpo tal como se habrían enviado.
 */
export function AdminSimulatedMailDialog({ mail, onClose }: { mail: SimulatedMail; onClose: () => void }) {
  return (
    <AdminDialog
      title={SIMULATED_MAIL_NOTICE}
      icon="mail"
      size="lg"
      description="No salió ningún correo: esto es lo que habría recibido el destinatario."
      onClose={onClose}
      footer={({ requestClose }) => (
        <AdminButton icon="close" type="button" onClick={requestClose}>
          Cerrar
        </AdminButton>
      )}
    >
      <div className="admin-demo-simulated">
        <AdminNote>Nada se envió a {mail.to}: en la demo ningún correo sale de verdad.</AdminNote>
        <AdminMailPreview preview={mail} />
      </div>
    </AdminDialog>
  );
}
