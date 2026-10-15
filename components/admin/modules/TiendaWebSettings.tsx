"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { publicConfig } from "@/lib/public-config";
import type { AdminRentalSettings as RentalSettingsView } from "@/lib/admin-types";
import type { CatalogAccessMode } from "@/lib/catalog-access-mode";
import Link from "next/link";
import { useAdminSession } from "../AdminShell";
import { EmailField, PhoneField, SwitchField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";
import { CatalogAccessModeField, CatalogAccessRequests } from "./CatalogAccessPanel";
import { StoreOrderPanel } from "./StoreOrderPanel";

/**
 * Ajustes → Tienda web: la tienda pública de la empresa (`/tienda/<slug>`). Encendido,
 * precios, frase de la portada, color de marca, WhatsApp y correo de contacto. Sin
 * tienda todavía, un solo botón «Crear tienda» la enciende con valores por defecto.
 * OWNER/ADMIN: el API revalida el rol y la empresa.
 */

type Form = {
  publicCatalogEnabled: boolean;
  publicShowPrices: boolean;
  storefrontTagline: string;
  catalogAccessMode: CatalogAccessMode;
  whatsappPhone: string;
  storefrontEmail: string;
};

function toForm(settings: RentalSettingsView): Form {
  return {
    publicCatalogEnabled: settings.publicCatalogEnabled,
    publicShowPrices: settings.publicShowPrices,
    storefrontTagline: settings.storefrontTagline ?? "",
    catalogAccessMode: settings.catalogAccessMode ?? "OPEN",
    whatsappPhone: settings.whatsappPhone ?? "",
    storefrontEmail: settings.storefrontEmail ?? "",
  };
}

const hasStore = (settings: RentalSettingsView) =>
  settings.publicCatalogEnabled || Boolean(settings.storefrontTagline || settings.storefrontAccent || settings.storefrontEmail || settings.whatsappPhone);

export function TiendaWebSettings() {
  const { demo, organization } = useAdminSession();
  const storeUrl = organization?.slug ? `${publicConfig.siteUrl}/tienda/${organization.slug}` : null;
  const resource = useAdminResource("/api/admin/settings/rental", (payload) => (payload.settings ?? null) as RentalSettingsView | null);
  const initial = useMemo(() => (resource.data ? toForm(resource.data) : null), [resource.data]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const dirty = Boolean(form && initial && JSON.stringify(form) !== JSON.stringify(initial));

  async function send(body: Record<string, unknown>, done: string) {
    setError("");
    setNotice("");
    setBusy(true);
    const result = await adminSend<{ settings: RentalSettingsView }>("/api/admin/settings/rental", body, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(done);
    resource.reload();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !initial) return;
    const body: Record<string, unknown> = {};
    if (form.publicCatalogEnabled !== initial.publicCatalogEnabled) body.publicCatalogEnabled = form.publicCatalogEnabled;
    if (form.publicShowPrices !== initial.publicShowPrices) body.publicShowPrices = form.publicShowPrices;
    // La frase de la portada se edita solo en Ajustes → Apariencia.
    if (form.catalogAccessMode !== initial.catalogAccessMode) body.catalogAccessMode = form.catalogAccessMode;
    if (form.whatsappPhone !== initial.whatsappPhone) body.whatsappPhone = form.whatsappPhone || null;
    if (form.storefrontEmail !== initial.storefrontEmail) body.storefrontEmail = form.storefrontEmail || null;
    await send(body, "Guardamos los ajustes de la tienda web.");
  }

  async function copyLink() {
    if (!storeUrl) return;
    try {
      await navigator.clipboard.writeText(storeUrl);
      setNotice("Link de la tienda copiado.");
    } catch {
      setError("No pudimos copiar; seleccioná el link y copialo a mano.");
    }
  }

  return (
    <div className="admin-module-page">
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={4}>
        {resource.data && !hasStore(resource.data) ? (
          <AdminPanel title="Tienda web" icon="globe">
            <p className="admin-field-hint">
              Todavía no tenés tienda web. Con un clic queda encendida con valores por defecto: mostrando precios y con el catálogo vacío,
              porque ningún producto se publica solo. Después elegís qué se ve en Inventario (Oculto, Cliente final, Mayorista o Ambos).
            </p>
            <AdminButton variant="primary" icon="plus" busy={busy} disabled={demo} onClick={() => void send({ publicCatalogEnabled: true, publicShowPrices: true }, "Creamos tu tienda web. Ahora elegí qué productos publicar en Inventario.")}>
              Crear tienda
            </AdminButton>
          </AdminPanel>
        ) : form ? (
          <form className="admin-settings" onSubmit={(event) => void save(event)}>
            <AdminPanel title="Tu tienda web" icon="globe">
              {storeUrl ? (
                <div data-testid="store-link">
                  <p className="admin-field-hint">
                    {initial?.publicCatalogEnabled ? (
                      <>
                        Link de tu tienda:{" "}
                        <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                          {storeUrl}
                        </a>
                      </>
                    ) : (
                      <>
                        Tu tienda está apagada: el link <strong>{storeUrl}</strong> responde «no encontrado» hasta que la enciendas y guardes.
                      </>
                    )}
                  </p>
                  <span className="admin-actions">
                    <AdminButton type="button" icon="copy" onClick={() => void copyLink()}>Copiar link</AdminButton>
                  </span>
                </div>
              ) : null}
              <div className="admin-settings-grid">
                <SwitchField
                  label="Tienda encendida"
                  checked={form.publicCatalogEnabled}
                  onChange={(checked) => setForm({ ...form, publicCatalogEnabled: checked })}
                  hint="Publica la tienda con los productos que marcaste para cliente final. Apagada, el link no existe."
                  disabled={demo || busy}
                />
                <SwitchField
                  label="Mostrar precios"
                  checked={form.publicShowPrices}
                  onChange={(checked) => setForm({ ...form, publicShowPrices: checked })}
                  hint="Apagado, la tienda pide cotización en vez de mostrar precios."
                  disabled={demo || busy}
                />
              </div>
            </AdminPanel>

            <AdminPanel title="Portada y contacto" icon="building">
              <div className="admin-settings-grid">
                <PhoneField
                  label="WhatsApp de la empresa"
                  value={form.whatsappPhone}
                  onChange={(value) => setForm({ ...form, whatsappPhone: value })}
                  hint="Número al que llegan las consultas y los pedidos de la tienda."
                  disabled={demo || busy}
                />
                <EmailField
                  label="Correo de contacto"
                  value={form.storefrontEmail}
                  onChange={(value) => setForm({ ...form, storefrontEmail: value })}
                  hint="Se muestra en la sección Contacto. Vacío, no se muestra."
                  disabled={demo || busy}
                />
              </div>
              <p className="admin-field-hint">
                El color de marca, la plantilla, la tipografía y la portada están en <Link href="/ajustes/apariencia">Ajustes → Apariencia</Link>.
              </p>
            </AdminPanel>

            <AdminPanel title="Acceso al catálogo" icon="lock" meta="Lo elige cada empresa">
              <div className="admin-settings-grid">
                <CatalogAccessModeField value={form.catalogAccessMode} onChange={(mode) => setForm({ ...form, catalogAccessMode: mode })} disabled={demo || busy} />
              </div>
              {initial && initial.catalogAccessMode !== form.catalogAccessMode ? <p className="admin-field-hint">Guardá los ajustes para que el cambio rija en la tienda.</p> : null}
            </AdminPanel>

            {initial?.catalogAccessMode === "REQUEST" || form.catalogAccessMode === "REQUEST" ? <CatalogAccessRequests canDecide={!demo} /> : null}

            <AdminPanel title="Catálogo mayorista" icon="inventory">
              <p className="admin-field-hint">
                El catálogo mayorista no es público: se comparte con un link privado por cliente desde su ficha
                (Clientes → ficha → «Compartir catálogo mayorista»). Muestra los productos marcados como Mayorista o Ambos con el precio mayorista.
              </p>
            </AdminPanel>

            <div className="admin-settings-actions">
              <AdminButton type="submit" variant="primary" icon="check" busy={busy} disabled={demo || !dirty}>
                Guardar ajustes
              </AdminButton>
            </div>
          </form>
        ) : null}
        {form && resource.data && hasStore(resource.data) ? <StoreOrderPanel readOnly={demo} /> : null}
      </AdminDataState>
    </div>
  );
}
