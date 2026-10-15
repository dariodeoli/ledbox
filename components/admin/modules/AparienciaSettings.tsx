"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import {
  ANNOUNCEMENT_MAX,
  COVER_KINDS,
  COVER_MAX_BYTES,
  COVER_SPEC,
  DEFAULT_APPEARANCE,
  FONTS,
  PRICE_MODES,
  PRICE_MODE_LABEL,
  TEMPLATE_META,
  adjustBrandColor,
  sniffImageMime,
  type Appearance,
  type CoverKind,
  type FontId,
  type PriceMode,
  type TemplateId,
} from "@/lib/appearance";
import { normalizeHex } from "@/lib/storefront-theme";
import { DISPLAY_FONTS, THEMES, isDisplayFont, themePrimary } from "@/lib/storefront-templates";
import { themesByRubro } from "@/lib/storefront-themes";
import { useAdminSession } from "../AdminShell";
import { FileField, SegmentedField, SelectField, SwitchField, TextField } from "../AdminFields";
import { AdminButton, AdminButtonLink, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";
import { StorePreview } from "./StorePreview";
import { EMPTY_HOME_PHOTOS, HomeLayoutPanels, type HomePhotoStates } from "./HomeLayoutPanels";
import { DEFAULT_HOME, HOME_PHOTO_SLOTS, type HomeConfig, type HomePhotoSlot } from "@/lib/store-home";

/**
 * Ajustes → Apariencia: cómo se ve la empresa para sus clientes (tienda y catálogo, mayorista, seguimiento del pedido,
 * portal, presupuesto impreso y correos; en los correos solo el color y el logo). Todo sale de listas cerradas y tokens
 * CSS, nunca CSS libre:
 *
 * - **Plantilla**: Lienzo, Boutique, Noir o Studio, agrupadas por rubro y con una vista previa real de cada una.
 * - **Color de marca** (primario) con control automático de contraste AA (≥ 4,5:1): si no alcanza se ajusta y se avisa.
 * - **Títulos**: tipografía de una lista curada. **Frase** de la tienda (título del héroe).
 * - **Barra de anuncio**: encendida o apagada, con su texto. **Modo de precio**: por día, por unidad o a cotizar.
 * - **Portada** (imagen del héroe): dos archivos (escritorio 1920×600 y celular 1080×1350), JPG/PNG/WebP de hasta 2 MB.
 * - **Logo**: se carga en Mi empresa (acá hay un acceso directo).
 * - **Tipografía del portal y del presupuesto**: lista cerrada (la tienda usa las de su plantilla).
 *
 * La vista previa en vivo usa las mismas clases que la tienda: lo que se ve acá es lo que se publica.
 * Nada se guarda hasta apretar «Guardar apariencia».
 */

const PRESET_COLORS = ["#0b5cd5", "#0f766e", "#b45309", "#9f1239", "#6d28d9", "#1f2937", "#047857", "#be123c"] as const;

type CoverState = { file: File | null; previewUrl: string | null; remove: boolean; dims: { width: number; height: number } | null };
const EMPTY_COVER: CoverState = { file: null, previewUrl: null, remove: false, dims: null };

type Loaded = { appearance: Appearance; brandColor: string | null; tagline: string | null; covers: Record<CoverKind, string | null>; homePhotos: Record<HomePhotoSlot, string | null>; slug: string | null };

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
  const [displayFont, setDisplayFont] = useState<string>("");
  const [annOn, setAnnOn] = useState(false);
  const [annText, setAnnText] = useState("");
  const [priceMode, setPriceMode] = useState<PriceMode>(DEFAULT_APPEARANCE.priceMode);
  const [tagline, setTagline] = useState("");
  const [color, setColor] = useState("");
  const [covers, setCovers] = useState<Record<CoverKind, CoverState>>({ desktop: EMPTY_COVER, mobile: EMPTY_COVER });
  const [coverError, setCoverError] = useState<Record<CoverKind, string>>({ desktop: "", mobile: "" });
  const [home, setHome] = useState<HomeConfig>(DEFAULT_HOME);
  const [homePhotos, setHomePhotos] = useState<HomePhotoStates>(EMPTY_HOME_PHOTOS);
  const [frame, setFrame] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (!initial) return;
    setTemplate(initial.appearance.template);
    setFont(initial.appearance.font);
    setDisplayFont(initial.appearance.displayFont ?? "");
    setAnnOn(initial.appearance.announcement.on);
    setAnnText(initial.appearance.announcement.text);
    setPriceMode(initial.appearance.priceMode);
    setTagline(initial.tagline ?? "");
    setColor(initial.brandColor ?? "");
    setCovers({ desktop: EMPTY_COVER, mobile: EMPTY_COVER });
    setHome(initial.appearance.home);
    setHomePhotos(EMPTY_HOME_PHOTOS);
  }, [initial]);

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const effective: Appearance = { template, font, displayFont: isDisplayFont(displayFont) ? displayFont : null, announcement: { on: annOn, text: annText.trim() }, priceMode, home };
  const brand = useMemo(() => adjustBrandColor(color), [color]);
  const brandHex = brand.ok ? brand.result?.color ?? null : null;
  const colorFieldError = !brand.ok ? brand.error : null;
  const annError = annOn && !annText.trim() ? "Escribí el texto de la barra de anuncio o apagala." : null;

  const dirty = Boolean(initial) && (
    template !== initial!.appearance.template ||
    font !== initial!.appearance.font ||
    (effective.displayFont ?? null) !== (initial!.appearance.displayFont ?? null) ||
    effective.announcement.on !== initial!.appearance.announcement.on ||
    effective.announcement.text !== initial!.appearance.announcement.text ||
    priceMode !== initial!.appearance.priceMode ||
    tagline.trim() !== (initial!.tagline ?? "") ||
    (normalizeHex(color) ?? null) !== (initial!.brandColor ?? null) ||
    COVER_KINDS.some((kind) => covers[kind].file || covers[kind].remove) ||
    JSON.stringify(home) !== JSON.stringify(initial!.appearance.home) ||
    HOME_PHOTO_SLOTS.some((slot) => homePhotos[slot].file || homePhotos[slot].remove)
  );
  const invalid = Boolean(colorFieldError) || Boolean(annError) || COVER_KINDS.some((kind) => coverError[kind]);

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
    // 1b) Fotos del inicio (editorial e inspiración), igual que las portadas.
    for (const slot of HOME_PHOTO_SLOTS) {
      const photo = homePhotos[slot];
      if (photo.remove && !photo.file) {
        const removed = await adminSend(`/api/admin/organization/appearance/home-photos/${slot}`, undefined, "DELETE");
        if (!removed.ok) {
          setBusy(false);
          setError(`${slot}: ${removed.error}`);
          return;
        }
      }
      if (photo.file) {
        const form = new FormData();
        form.append("file", photo.file, photo.file.name);
        const uploaded = await adminApiUpload(`/api/admin/organization/appearance/home-photos/${slot}`, form, { timeoutMs: 60_000 });
        if (!uploaded.ok) {
          setBusy(false);
          setError(`${slot}: ${uploaded.error}`);
          return;
        }
      }
    }
    // 2) Plantilla, tipografía, fondo y color (el servidor vuelve a validar el contraste).
    const result = await adminSend<{ appearance: Appearance; brandColor: string | null; tagline: string | null; brandNotice: string | null }>(
      "/api/admin/organization/appearance",
      { template, font, displayFont: effective.displayFont, announcement: effective.announcement, priceMode, home, tagline: tagline.trim(), brandColor: color.trim() ? color : null },
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
                  <div className="admin-template-groups" role="group" aria-label="Plantilla de la tienda">
                    {themesByRubro().map((group) => (
                      <section key={group.rubro} className="admin-template-group" aria-label={group.rubro}>
                        <h3 className="admin-template-rubro">{group.rubro}</h3>
                        <div className="admin-template-grid">
                          {group.themes.map((theme) => (
                            <button key={theme.id} type="button" className="admin-template-card" aria-pressed={template === theme.id} disabled={demo} onClick={() => { setTemplate(theme.id as TemplateId); setNotice(""); }} data-testid={`template-${theme.id}`}>
                              <StorePreview frame="mobile" size="thumb" appearance={{ ...effective, template: theme.id as TemplateId }} brandColor={brandHex} name={organization?.name ?? ""} coverSrc={null} tagline={tagline.trim() || null} />
                              <strong>{TEMPLATE_META[theme.id as TemplateId].label}</strong>
                              <span>{theme.forWho}</span>
                              <span>{theme.description}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </AdminPanel>

                <AdminPanel title="Color y textos" icon="sparkles" meta="El color pasa el contraste AA (mínimo 4,5:1) automáticamente">
                  <div className="admin-settings-grid">
                    <TextField
                      label="Color de marca (botones y enlaces)"
                      value={color}
                      onChange={(value) => { setColor(value); setNotice(""); }}
                      maxLength={7}
                      placeholder="#0b5cd5"
                      autoCapitalize="none"
                      error={colorFieldError}
                      hint="Hexadecimal. Vacío, o si no da contraste suficiente con la plantilla, se usa el color propio de la plantilla."
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
                      <span className="admin-store-swatch" style={{ background: themePrimary(template, brandHex).primary }} aria-hidden="true" />{" "}
                      {themePrimary(template, brandHex).fromBrand ? "Con esta plantilla se usa tu color de marca." : "Tu color no da contraste suficiente con esta plantilla: se usa su color propio."}
                    </p>
                  ) : null}
                  <div className="admin-settings-grid">
                    <TextField label="Frase de la tienda (título de la portada)" value={tagline} onChange={(value) => { setTagline(value); setNotice(""); }} maxLength={140} placeholder="Ej.: Espacios que se sienten" hint="Vacío, la portada dice «Alquiler para tu próximo evento»." disabled={demo} />
                    <SelectField
                      label="Tipografía de los títulos"
                      value={displayFont}
                      onChange={(value) => { setDisplayFont(value); setNotice(""); }}
                      options={[{ value: "", label: `La de la plantilla (${THEMES[template].fonts.display.label})` }, ...DISPLAY_FONTS.map((entry) => ({ value: entry.id, label: entry.label }))]}
                      hint="Fuentes de Google Fonts de una lista curada. El texto corrido usa la de la plantilla."
                      disabled={demo}
                    />
                  </div>
                </AdminPanel>

                <AdminPanel title="Barra de anuncio y precios" icon="edit">
                  <div className="admin-settings-grid">
                    <SwitchField label="Barra de anuncio" checked={annOn} onChange={(checked) => { setAnnOn(checked); setNotice(""); }} hint="Una franja arriba de todo con un aviso corto (envíos, promociones, feriados)." disabled={demo} />
                    {annOn ? (
                      <TextField label="Texto de la barra" value={annText} onChange={(value) => { setAnnText(value); setNotice(""); }} maxLength={ANNOUNCEMENT_MAX} placeholder="Ej.: Entregas en todo Asunción y Gran Asunción" error={annError} disabled={demo} />
                    ) : null}
                    <SelectField
                      label="Modo de precio"
                      value={priceMode}
                      onChange={(value) => { setPriceMode(value as PriceMode); setNotice(""); }}
                      options={PRICE_MODES.map((mode) => ({ value: mode, label: PRICE_MODE_LABEL[mode] }))}
                      disabled={demo}
                    />
                    <p className="admin-field-hint">
                      {priceMode === "day" ? "Los precios se muestran por día (o por evento, según cada producto)." : priceMode === "unit" ? "Los precios se muestran «c/u» y las cantidades suben de a 10 en las piezas sueltas (vajilla, copas); los juegos suben de a 1." : "La tienda no muestra montos: cada pedido se cotiza."}
                    </p>
                  </div>
                </AdminPanel>

                <AdminPanel title="Logo y tipografía del portal" icon="building">
                  <div className="admin-settings-grid">
                    <div className="admin-field">
                      <span className="admin-field-label">Logo de la empresa</span>
                      <p className="admin-field-hint">El logo (con su versión para fondos oscuros) se carga en Mi empresa y se usa en la tienda, el portal y los correos.</p>
                      <AdminButtonLink href="/ajustes/empresa" icon="building">Cargar el logo en Mi empresa</AdminButtonLink>
                    </div>
                    <SelectField label="Tipografía del portal y el presupuesto" value={font} onChange={(value) => { setFont(value as FontId); setNotice(""); }} options={FONTS.map((entry) => ({ value: entry.id, label: entry.label }))} hint="No cambia la tienda: ella usa las fuentes de su plantilla." disabled={demo} />
                  </div>
                </AdminPanel>

                <HomeLayoutPanels home={home} onHome={(next) => { setHome(next); setNotice(""); }} photos={homePhotos} onPhotos={(next) => { setHomePhotos(next); setNotice(""); }} versions={initial.homePhotos} disabled={demo} />

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
                  <StorePreview frame={frame} appearance={effective} brandColor={brandHex} name={organization?.name ?? ""} coverSrc={previewCover} tagline={tagline.trim() || null} />
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
