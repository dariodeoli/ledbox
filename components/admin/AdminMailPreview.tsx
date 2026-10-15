"use client";

import React from "react";
import type { SimulatedMail } from "@/lib/mail-preview";

/** First shared email preview: real server payload isolated from the panel.
 * Confirmation stays with the caller; this component never dispatches mail. */
export function AdminMailPreview({ preview }: { preview: SimulatedMail }) {
  return (
    <section aria-label="Vista previa del correo">
      <dl className="admin-dialog-facts">
        <div><dt>De</dt><dd>{preview.from}</dd></div>
        <div><dt>Para</dt><dd>{preview.to}</dd></div>
        <div><dt>Asunto</dt><dd>{preview.subject}</dd></div>
      </dl>
      <iframe className="admin-mail-preview" title="Vista previa del correo HTML" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} />
      <details>
        <summary className="admin-field-label">Alternativa en texto plano</summary>
        <pre className="admin-message-preview">{preview.text}</pre>
      </details>
    </section>
  );
}
