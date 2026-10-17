"use client";

import { AdminBadge, AdminButton, AdminDialog, AdminNote, TextField } from "@/components/ui";
import { useState } from "react";

/** Muestrario interno y no transaccional del kit visual canónico del panel. */
export default function UiKitPage() {
  const [showDialog, setShowDialog] = useState(false);
  return (
    <main className="admin-page ui-kit-page">
      <header className="ui-kit-header">
        <div><span className="admin-kicker">Biblioteca visual</span><h1 className="admin-title">Componentes <span>UI</span></h1><p className="admin-lede">Muestrario de piezas canónicas de <code>components/ui</code>. Los controles de esta página son demostrativos y no guardan datos.</p></div>
      </header>

      <section className="ui-kit-section" aria-labelledby="ui-kit-buttons">
        <div className="ui-kit-section-head"><div><span className="admin-card-index">01 · Acciones</span><h2 id="ui-kit-buttons">Botones y estados</h2></div><p>Variantes de acción y etiquetas accesibles.</p></div>
        <div className="ui-kit-themes">
          {(["dark", "light"] as const).map((theme) => <div className="admin-root ui-kit-sample" data-theme={theme} key={theme}>
            <h3>{theme === "dark" ? "Oscuro" : "Claro"}</h3>
            <div className="ui-kit-row"><AdminButton variant="primary" type="button">Principal</AdminButton><AdminButton variant="secondary" type="button">Secundario</AdminButton><AdminButton variant="ghost" type="button">Terciario</AdminButton><AdminButton variant="danger" type="button">Destructivo</AdminButton><AdminButton variant="secondary" size="sm" type="button">Compacto</AdminButton></div>
            <div className="ui-kit-row"><AdminBadge tone="ok">Disponible</AdminBadge><AdminBadge tone="warn">Pendiente</AdminBadge><AdminBadge tone="danger">Revisar</AdminBadge><AdminBadge tone="info">Informativo</AdminBadge><AdminBadge tone="neutral">Inactivo</AdminBadge><AdminBadge tone="accent">Destacado</AdminBadge></div>
            <div className="ui-kit-notes"><AdminNote tone="ok">Operación completada correctamente.</AdminNote><AdminNote tone="warn">Hay información que conviene revisar.</AdminNote><AdminNote tone="error">No se pudo completar la operación.</AdminNote></div>
            <div className="ui-kit-fields"><TextField label="Campo de ejemplo" value="Panel LED 2 × 3" onChange={() => undefined} hint="Ayuda contextual bajo el campo." /><TextField label="Campo con error" value="LED-023" onChange={() => undefined} error="Código de ejemplo con error." /></div>
          </div>)}
        </div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-fields">
        <div className="ui-kit-section-head"><div><span className="admin-card-index">02 · Entrada</span><h2 id="ui-kit-fields">Campos</h2></div><p>Etiquetas, ayuda, error y estados de lectura.</p></div>
        <div className="ui-kit-themes">{(["dark", "light"] as const).map((theme) => <div className="admin-root ui-kit-sample" data-theme={theme} key={theme}><h3>{theme === "dark" ? "Oscuro" : "Claro"}</h3><div className="ui-kit-fields"><TextField label="Solo lectura" value="Valor bloqueado" onChange={() => undefined} readOnly /><TextField label="Deshabilitado" value="No disponible" onChange={() => undefined} disabled /></div></div>)}</div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-dialogs">
        <div className="ui-kit-section-head"><div><span className="admin-card-index">03 · Superposición</span><h2 id="ui-kit-dialogs">Diálogo</h2></div><p>Vista de una ventana canónica con contenido estático.</p></div>
        <div className="ui-kit-themes">{(["dark", "light"] as const).map((theme) => <div className="admin-root ui-kit-sample" data-theme={theme} key={theme}><h3>{theme === "dark" ? "Oscuro" : "Claro"}</h3><div className="ui-kit-row"><AdminButton variant="secondary" type="button" onClick={() => setShowDialog(true)}>Abrir vista previa del diálogo</AdminButton><span className="admin-note">Solo contiene datos ficticios.</span></div></div>)}</div>
      </section>
      {showDialog ? <AdminDialog title="Vista previa" description="Ejemplo de diálogo canónico" onClose={() => setShowDialog(false)} footer={<><AdminButton variant="ghost" type="button" onClick={() => setShowDialog(false)}>Cerrar</AdminButton><AdminButton variant="primary" type="button" onClick={() => setShowDialog(false)}>Entendido</AdminButton></>}><p className="admin-note">Este contenido es ilustrativo. No se envían ni guardan datos.</p></AdminDialog> : null}
      <p className="ui-kit-footnote">Solo lectura · datos ficticios · componentes compartidos</p>
    </main>
  );
}
