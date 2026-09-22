"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { logoVariantLabel } from "@/lib/admin-format";
import { organizationLogoUrl, type AdminOrganizationLogos, type LogoVariant } from "@/lib/admin-types";
import { normalizePersonName, personNameValid } from "@/lib/field-rules";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { useAdminSession } from "../AdminShell";
import { AdminOrgLogo } from "../AdminAvatar";
import { TextField } from "../AdminFields";
import { AdminButton, AdminImageUpload, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Empresa (issue #22): OWNER/ADMIN editan el **nombre** de la empresa —el que
 * se ve en el chip del panel y en las hojas imprimibles— y suben los **dos
 * logos** (claro y oscuro) con las mismas reglas que el avatar: JPG/PNG/WebP
 * hasta 1 MB, comprimidos en el navegador, validados por magic bytes y servidos
 * solo con sesión.
 *
 * El identificador (`slug`) no se edita: es la referencia estable de la empresa.
 * Los datos de pago siguen en Presupuestos → «Datos de pago».
 */

const EMPTY_LOGOS: AdminOrganizationLogos = { light: null, dark: null };

/** Fondo sobre el que se ve cada variante: la clara sobre oscuro y al revés. */
const VARIANT_TONES: Record<LogoVariant, "dark" | "light"> = { light: "dark", dark: "light" };

export function EmpresaModule() {
  const { demo, reload } = useAdminSession();
  const branding = useAdminResource("/api/admin/organization/branding", (payload) => ({
    organization: payload.organization ?? null,
    logos: payload.logos ?? EMPTY_LOGOS,
  }));
  const organization = branding.data?.organization ?? null;
  const readOnly = demo;

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [notice, setNotice] = useState("");
  const [savingLogo, setSavingLogo] = useState<LogoVariant | null>(null);
  const [logoError, setLogoError] = useState("");
  const [pendingLogos, setPendingLogos] = useState<Partial<Record<LogoVariant, string>>>({});
  const [versions, setVersions] = useState<Partial<Record<LogoVariant, string | null>>>({});

  useEffect(() => {
    if (organization) setName(organization.name);
  }, [organization]);

  const logos = useMemo<AdminOrganizationLogos>(() => {
    const base = branding.data?.logos ?? EMPTY_LOGOS;
    return { light: versions.light ?? base.light, dark: versions.dark ?? base.dark };
  }, [branding.data, versions]);

  function logoSrc(variant: LogoVariant): string | null {
    const pending = pendingLogos[variant];
    if (pending) return pending;
    const version = logos[variant];
    return version ? organizationLogoUrl(variant, version) : null;
  }

  const nameChanged = Boolean(organization) && normalizePersonName(name) !== organization?.name;

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    setSavingName(true);
    setNotice("");
    const result = await adminSend("/api/admin/organization/branding", { name: normalizePersonName(name) }, "PATCH");
    setSavingName(false);
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    setNameError("");
    setNotice("Guardamos el nombre de la empresa: ya se ve en el chip del panel y en las hojas imprimibles.");
    branding.reload();
    reload();
  }

  async function uploadLogo(variant: LogoVariant, image: PreparedIdentityImage) {
    setSavingLogo(variant);
    setLogoError("");
    setNotice("");
    const result = await adminSend<{ updatedAt?: string }>(
      `/api/admin/organization/branding/logos/${variant}`,
      { data: image.base64, mime: image.mime, width: image.width, height: image.height },
    );
    setSavingLogo(null);
    if (!result.ok) {
      setLogoError(result.error);
      return;
    }
    setPendingLogos((current) => ({ ...current, [variant]: image.dataUrl }));
    setVersions((current) => ({ ...current, [variant]: result.data.updatedAt ?? null }));
    setNotice(`${logoVariantLabel(variant)} actualizado.`);
    branding.reload();
    reload();
  }

  async function removeLogo(variant: LogoVariant) {
    if (!window.confirm(`¿Quitar el ${logoVariantLabel(variant).toLowerCase()}? En la hoja imprimible vuelve el monograma LB.`)) return;
    setSavingLogo(variant);
    setLogoError("");
    setNotice("");
    const result = await adminSend(`/api/admin/organization/branding/logos/${variant}`, undefined, "DELETE");
    setSavingLogo(null);
    if (!result.ok) {
      setLogoError(result.error);
      return;
    }
    setPendingLogos((current) => ({ ...current, [variant]: undefined }));
    setVersions((current) => ({ ...current, [variant]: null }));
    setNotice(`${logoVariantLabel(variant)} quitado.`);
    branding.reload();
    reload();
  }

  return (
    <div className="admin-module-page">
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {logoError ? <AdminNote tone="error">{logoError}</AdminNote> : null}

      <AdminPanel
        title="Datos de la empresa" icon="building"
        meta={organization ? `Identificador: ${organization.slug}` : undefined}
      >
        <form className="admin-settings" onSubmit={saveName}>
          <div className="admin-settings-grid">
            <TextField
              label="Nombre"
              required
              maxLength={120}
              value={name}
              onChange={(value) => {
                setName(value);
                setNameError("");
                setNotice("");
              }}
              error={nameError}
              disabled={readOnly || !organization}
              hint="Se ve en el chip del panel y en las hojas imprimibles."
            />
            <div className="admin-settings-readonly">
              <span className="admin-field-label">Identificador</span>
              <p className="admin-detail-value">{organization?.slug ?? "—"}</p>
              <span className="admin-field-hint">No se edita: es la referencia estable de la empresa.</span>
            </div>
          </div>
          <div className="admin-settings-actions">
            <AdminButton
              type="submit"
              variant="primary"
              icon="check"
              busy={savingName}
              disabled={readOnly || !organization || !nameChanged || !personNameValid(name)}
            >
              Guardar nombre
            </AdminButton>
            <Link className="admin-panel-link" href="/presupuestos" title="Los datos de pago se cargan en Presupuestos">
              Datos de pago de la empresa
            </Link>
          </div>
        </form>
      </AdminPanel>

      <AdminPanel title="Logo por tema" icon="image" meta="Se usan según el fondo; en papel siempre el claro">
        <div className="admin-settings">
          <p className="admin-field-hint">
            JPG, PNG o WebP hasta 1 MB; sin logo queda el monograma LB.
          </p>
          <div className="admin-logos">
            {(["light", "dark"] as const).map((variant) => (
              <AdminImageUpload
                key={variant}
                label={logoVariantLabel(variant)}
                mode="logo"
                hint={
                  variant === "light"
                    ? "Para fondos oscuros (panel en modo oscuro)."
                    : "Para fondos claros (modo claro y papel)."
                }
                preview={
                  <span className="admin-logo-tone" data-tone={VARIANT_TONES[variant]}>
                    <AdminOrgLogo
                      name={organization?.name}
                      variant={variant}
                      lightSrc={logoSrc(variant)}
                      darkSrc={logoSrc(variant)}
                      size={64}
                    />
                  </span>
                }
                busy={savingLogo === variant}
                disabled={readOnly || !organization || savingLogo !== null}
                onPrepared={(image) => void uploadLogo(variant, image)}
                onRemove={logos[variant] ? () => void removeLogo(variant) : undefined}
                removeLabel={`Quitar ${logoVariantLabel(variant).toLowerCase()}`}
              />
            ))}
          </div>
        </div>
      </AdminPanel>
    </div>
  );
}
