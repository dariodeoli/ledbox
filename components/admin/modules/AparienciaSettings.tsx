"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import {
  COVER_KINDS,
  COVER_MAX_BYTES,
  COVER_SPEC,
  DEFAULT_APPEARANCE,
  FONTS,
  TEMPLATES,
  TEMPLATE_META,
  adjustBrandColor,
  parseBackground,
  sniffImageMime,
  type Appearance,
  type CoverKind,
  type FontId,
  type TemplateId,
} from "@/lib/appearance";
import { normalizeHex } from "@/lib/storefront-theme";
import { useAdminSession } from "../AdminShell";
import { FileField, SegmentedField, SelectField, SwitchField, TextField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";
import { StorePreview } from "./StorePreview";

/**
 * Ajustes → Apariencia: cómo se ve la empresa para sus clientes (tienda y catálogo, mayorista,
 * seguimiento del pedido, portal, presupuesto impreso y correos; en los correos solo el color y el
 * logo). Todo sale de listas cerradas y tokens CSS, nunca CSS libre:
 *
 * - **Plantilla**: Clásica, Minimalista, Elegante u Oscura.
 * - **Color de marca** con control automático de contraste AA (≥ 4,5:1): si no alcanza se ajusta y se avisa.
 * - **Tipografía** de una lista cerrada de Google Fonts.
 * - **Portada**: dos archivos separados (escritorio 1920×600 y celular 1080×1350), JPG/PNG/WebP de
 *   hasta 2 MB; el servidor valida por magic bytes y los comprime con sharp.
 * - **Fondo** claro opcional.
 *
 * La vista previa en vivo usa las mismas clases que la tienda: lo que se ve acá es lo que se publica.
 * Nada se guarda hasta apretar «Guardar apariencia».
 */

const PRESET_COLORS = ["#0b5cd5", "#0f766e", "#b45309", "#9f1239", "#6d28d9", "#1f2937", "#047857", "#be123c"] as const;

type CoverState = { file: File | null; previewUrl: string | null; remove: boolean; dims: { width: number; height: number } | null };
const EMPTY_COVER: CoverState = { file: null, previewUrl: null, remove: false, dims: null };

type Loaded = { appearance: Appearance; brandColor: string | null; covers: Record<CoverKind, string | null>; slug: string | null };

function readImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function bytesLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AparienciaSettings() {
  const { demo, organization } = useAdminSession();
  const resource = useAdminResource("/api/admin/organization/appearance", (payload) => payload as unknown as Loaded);
  const initial = resource.data;
  const [template, setTemplate] = useState<TemplateId>(DEFAULT_APPEARANCE.template);
  const [font, setFont] = useState<FontId>(DEFAULT_APPEARANCE.font);
  const [bgOn, setBgOn] = useState(false);
  const [background, setBackground] = useState("");
  const [color, setColor] = useState("");
  const [covers, setCovers] = useState<Record<CoverKind, CoverState>>({ desktop: EMPTY_COVER, mobile: EMPTY_COVER });
  const [coverError, setCoverError] = useState<Record<CoverKind, string>>({ desktop: "", mobile: "" });
  const [frame, setFrame] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (!initial) return;
    setTemplate(initial.appearance.template);
    setFont(initial.appearance.font);
    setBgOn(Boolean(initial.appearance.background));
    setBackground(initial.appearance.background ?? "");
    setColor(initial.brandColor ?? "");
    setCovers({ desktop: EMPTY_COVER, mobile: EMPTY_COVER });
  }, [initial]);

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const backgroundCheck = bgOn ? parseBackground(background) : ({ ok: true, background: null } as const);
  const effective: Appearance = { template, font, background: backgroundCheck.ok ? backgroundCheck.background : null };
  const brand = useMemo(() => adjustBrandColor(color, { background: effective.background }), [color, effective.background]);
  const brandHex = brand.ok ? brand.result?.color ?? null : null;
  const colorFieldError = !brand.ok ? brand.error : null;

  const dirty = Boolean(initial) && (
    template !== initial!.appearance.template ||
    font !== initial!.appearance.font ||
    (effective.background ?? null) !== (initial!.appearance.background ?? null) ||
    (normalizeHex(color) ?? null) !== (initial!.brandColor ?? null) ||
    COVER_KINDS.some((kind) => covers[kind].file || covers[kind].remove)
  );
  const invalid = Boolean(colorFieldError) || !backgroundCheck.ok || COVER_KINDS.some((kind) => coverError[kind]);

  const pickCover = useCallback(async (kind: CoverKind, file: File | null) => {
    setNotice("");
    setCoverError((current) => ({ ...current, [kind]: "" }));
    if (!file) return;
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffImageMime(header)) {
      setCoverError((current) => ({ ...current, [kind]: "El archivo no es un JPG, PNG o WebP real: revisá que no esté renombrado." }));
      return;
    }
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    const dims = await readImageSize(url);
    if (!dims) {
      setCoverError((current) => ({ ...current, [kind]: "No pudimos leer la imagen; probá con otra." }));
      return;
    }
    setCovers((current) => {
      if (current[kind].previewUrl) URL.revokeObjectURL(current[kind].previewUrl!);
      return { ...current, [kind]: { file, previewUrl: url, remove: false, dims } };
    });
  }, []);

  async function save() {
    if (!initial || busy || invalid) return;
    setBusy(true);
    setError("");
    setNotice("");
    // 1) Portadas: primero los archivos (el servidor valida bytes mágicos y comprime con sharp).
    for (const kind of COVER_KINDS) {
      const cover = covers[kind];
      if (cover.remove && !cover.file) {
        const removed = await adminSend(`/api/admin/organization/appearance/covers/${kind}`, undefined, "DELETE");
        if (!removed.ok) {
          setBusy(false);
          setError(`${COVER_SPEC[kind].label}: ${removed.error}`);
          return;
        }
      }
      if (cover.file) {
        const form = new FormData();
        form.append("file", cover.file, cover.file.name);
        const uploaded = await adminApiUpload(`/api/admin/organization/appearance/covers/${kind}`, form, { timeoutMs: 60_000 });
        if (!uploaded.ok) {
          setBusy(false);
          setError(`${COVER_SPEC[kind].label}: ${uploaded.error}`);
          return;
        }
      }
    }
    // 2) Plantilla, tipografía, fondo y color (el servidor vuelve a validar el contraste).
    const result = await adminSend<{ appearance: Appearance; brandColor: string | null; brandNotice: string | null }>(
      "/api/admin/organization/appearance",
      { template, font, background: effective.background, brandColor: color.trim() ? color : null },
      "PATCH",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(result.data.brandNotice ? `Guardamos la apariencia. ${result.data.brandNotice}` : "Guardamos la apariencia: ya se aplica en la tienda, el portal, el presupuesto impreso y los correos.");
    resource.reload();
  }

  const savedUrl = (kind: CoverKind) => (initial?.covers[kind] ? `/api/admin/organization/appearance/covers/${kind}?v=${encodeURIComponent(initial.covers[kind]!)}` : null);
  const coverSrc = (kind: CoverKind) => (covers[kind].remove ? null : covers[kind].previewUrl ?? savedUrl(kind));
  const previewCover = coverSrc(frame) ?? (coverSrc(frame === "desktop" ? "mobile" : "desktop"));
  const storeUrl = organization?.slug ? `/tienda/${organization.slug}` : null;

  return (
    <div className="admin-module-page">
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={4}>
        {initial ? (
          <form
            className="admin-settings"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            data-testid="apariencia"
          >
            <div className="admin-appearance-grid">
              <div className="admin-settings">
                <AdminPanel title="Plantilla" icon="image" meta="Cambia el diseño de la tienda; el contenido es el mismo">
                  <div className="admin-template-grid" role="group" aria-label="Plantilla de la tienda">
                    {TEMPLATES.map((id) => (
                      <button key={id} type="button" className="admin-template-card" aria-pressed={template === id} disabled={demo} onClick={() => { setTemplate(id); setNotice(""); }}>
                        <strong>{TEMPLATE_META[id].label}</strong>
                        <span>{TEMPLATE_META[id].description}</span>
                      </button>
                    ))}
                  </div>
                </AdminPanel>

                <AdminPanel title="Color de marca" icon="sparkles" meta="Contraste AA automático (mínimo 4,5:1)">
                  <div className="admin-settings-grid">
                    <TextField
                      label="Color de marca"
                      value={color}
                      onChange={(value) => { setColor(value); setNotice(""); }}
                      maxLength={7}
                      placeholder="#0b5cd5"
                      autoCapitalize="none"
                      error={colorFieldError}
                      hint="Hexadecimal. Vacío, la tienda usa un tema neutro."
                      disabled={demo}
                    />
                    <div className="admin-field">
                      <span className="admin-field-label">Colores sugeridos</span>
                      <div className="admin-swatches" role="group" aria-label="Colores sugeridos">
                        {PRESET_COLORS.map((preset) => (
                          <button key={preset} type="button" className="admin-swatch" style={{ background: preset }} aria-label={`Usar ${preset}`} aria-pressed={normalizeHex(color) === preset} disabled={demo} onClick={() => { setColor(preset); setNotice(""); }} />
                        ))}
                      </div>
                    </div>
                  </div>
                  {brand.ok && brand.result?.adjusted ? (
                    <AdminNote tone="warn"><span data-testid="brand-adjusted">{brand.result.notice}</span></AdminNote>
                  ) : brandHex ? (
                    <p className="admin-field-hint" data-testid="accent-preview">
                      <span className="admin-store-swatch" style={{ background: brandHex }} aria-hidden="true" /> Contraste suficiente. En modo oscuro se aclara solo.
                    </p>
                  ) : null}
                </AdminPanel>

                <AdminPanel title="Tipografía y fondo" icon="edit">
                  <div className="admin-settings-grid">
                    <SelectField label="Tipografía" value={font} onChange={(value) => { setFont(value as FontId); setNotice(""); }} options={FONTS.map((entry) => ({ value: entry.id, label: entry.label }))} hint="Fuentes de Google Fonts de una lista cerrada." disabled={demo} />
                    <SwitchField label="Fondo propio" checked={bgOn} onChange={(checked) => { setBgOn(checked); setNotice(""); }} hint="Un color claro de fondo. Para fondo oscuro usá la plantilla Oscura." disabled={demo} />
                    {bgOn ? (
                      <TextField label="Color de fondo" value={background} onChange={(value) => { setBackground(value); setNotice(""); }} maxLength={7} placeholder="#f6f1e8" autoCapitalize="none" error={!backgroundCheck.ok ? backgroundCheck.error : null} disabled={demo} />
                    ) : null}
                  </div>
                </AdminPanel>

                <AdminPanel title="Portada" icon="image" meta="Dos archivos separados · JPG, PNG o WebP · máximo 2 MB cada uno">
                  <div className="admin-settings">
                    {COVER_KINDS.map((kind) => {
                      const spec = COVER_SPEC[kind];
                      const state = covers[kind];
                      const src = coverSrc(kind);
                      const dims = state.dims;
                      const ratioOff = dims ? Math.abs(dims.width / dims.height - spec.width / spec.height) / (spec.width / spec.height) > 0.12 : false;
                      return (
                        <div className="admin-cover-box" key={kind} data-testid={`cover-${kind}`}>
                          <FileField
                            label={spec.label}
                            hint={`${spec.hint} Máximo ${bytesLabel(COVER_MAX_BYTES)}.`}
                            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                            maxBytes={COVER_MAX_BYTES}
                            file={state.file}
                            error={coverError[kind] || null}
                            disabled={demo}
                            onSelect={(file) => { if (file) void pickCover(kind, file); else setCovers((current) => ({ ...current, [kind]: EMPTY_COVER })); }}
                          />
                          <div className="admin-cover-frame" data-kind={kind} style={{ aspectRatio: `${spec.width} / ${spec.height}` }}>
                            {src ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={src} alt={`Vista previa de la ${spec.label.toLowerCase()} con su recorte`} />
                            ) : (
                              <span>Sin portada: se usa el encabezado simple</span>
                            )}
                          </div>
                          {dims ? <p className="admin-field-hint">Tu imagen mide {dims.width} × {dims.height} px{ratioOff ? ` y no tiene la proporción recomendada: se recorta como ves arriba.` : "."}{dims.width < spec.width * 0.6 ? " Es más chica que la recomendada y puede verse borrosa." : ""}</p> : null}
                          {src ? (
                            <AdminButton type="button" icon="trash" disabled={demo} onClick={() => setCovers((current) => ({ ...current, [kind]: { ...EMPTY_COVER, remove: true } }))}>
                              Quitar {spec.label.toLowerCase()}
                            </AdminButton>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </AdminPanel>
              </div>

              <AdminPanel title="Vista previa en vivo" icon="eye" meta="Con datos de ejemplo; todavía no está publicada">
                <div className="admin-settings">
                  <SegmentedField
                    ariaLabel="Dispositivo de la vista previa"
                    value={frame}
                    onChange={(value) => setFrame(value as "desktop" | "mobile")}
                    options={[{ value: "desktop", label: "Escritorio" }, { value: "mobile", label: "Celular" }]}
                  />
                  <StorePreview frame={frame} appearance={effective} brandColor={brandHex} name={organization?.name ?? ""} coverSrc={previewCover} />
                  {storeUrl ? <p className="admin-field-hint">La tienda real está en {storeUrl}. Si no tiene portada de {frame === "desktop" ? "escritorio" : "celular"}, usa la otra.</p> : null}
                </div>
              </AdminPanel>
            </div>

            <div className="admin-settings-actions">
              <AdminButton type="submit" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={demo || !dirty || invalid}>
                Guardar apariencia
              </AdminButton>
            </div>
          </form>
        ) : null}
      </AdminDataState>
    </div>
  );
}
