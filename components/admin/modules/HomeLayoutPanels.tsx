"use client";

import { useEffect, useRef, useState } from "react";
import { HOME_LIMITS, HOME_LOCKED, HOME_PHOTO_LABEL, HOME_SECTION_LABEL, INSPIRATION_SLOTS, moveSection, moveSectionTo, type HomeConfig, type HomePhotoSlot, type HomeSectionId } from "@/lib/store-home";
import { FileField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { AdminButton, AdminPanel } from "../AdminUI";

/**
 * Ajustes → Apariencia → «Inicio de la tienda»: el orden de las secciones del inicio (se arrastran o se usa «Subir /
 * Bajar», que es la vía por teclado), cuáles se muestran, el bloque editorial y las fotos de inspiración, cada una con su
 * texto. Presentacional: el estado vive en `AparienciaSettings`, que guarda todo junto con «Guardar apariencia».
 */

export type HomePhotoState = { file: File | null; remove: boolean };
export type HomePhotoStates = Record<HomePhotoSlot, HomePhotoState>;
export const EMPTY_HOME_PHOTOS: HomePhotoStates = { editorial: { file: null, remove: false }, "inspiracion-1": { file: null, remove: false }, "inspiracion-2": { file: null, remove: false }, "inspiracion-3": { file: null, remove: false } };

const HOME_PHOTO_MAX = 2 * 1024 * 1024;

function PhotoBox({ slot, state, version, disabled, onChange }: { slot: HomePhotoSlot; state: HomePhotoState; version: string | null; disabled: boolean; onChange: (next: HomePhotoState) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    lastUrl.current = state.file ? URL.createObjectURL(state.file) : null;
    setPreview(lastUrl.current);
    return () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); };
  }, [state.file]);
  const src = state.remove ? null : preview ?? (version ? `/api/admin/organization/appearance/home-photos/${slot}?v=${encodeURIComponent(version)}` : null);
  return (
    <div className="admin-cover-box" data-testid={`home-photo-${slot}`}>
      <FileField
        label={HOME_PHOTO_LABEL[slot]}
        hint="JPG, PNG o WebP de hasta 2 MB. Mejor vertical (4:5)."
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        maxBytes={HOME_PHOTO_MAX}
        file={state.file}
        disabled={disabled}
        onSelect={(file) => onChange({ file, remove: false })}
      />
      <div className="admin-cover-frame" data-ratio="4-5">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Vista previa: ${HOME_PHOTO_LABEL[slot].toLowerCase()}`} />
        ) : (
          <span>Sin foto</span>
        )}
      </div>
      {src ? <AdminButton type="button" icon="trash" disabled={disabled} onClick={() => onChange({ file: null, remove: true })}>Quitar esta foto</AdminButton> : null}
    </div>
  );
}

export function HomeLayoutPanels({ home, onHome, photos, onPhotos, versions, disabled }: {
  home: HomeConfig;
  onHome: (next: HomeConfig) => void;
  photos: HomePhotoStates;
  onPhotos: (next: HomePhotoStates) => void;
  versions: Record<HomePhotoSlot, string | null>;
  disabled: boolean;
}) {
  const [drag, setDrag] = useState<HomeSectionId | null>(null);
  const hidden = new Set(home.hidden);
  const setPhoto = (slot: HomePhotoSlot, next: HomePhotoState) => onPhotos({ ...photos, [slot]: next });
  const toggle = (id: HomeSectionId, visible: boolean) => onHome({ ...home, hidden: visible ? home.hidden.filter((other) => other !== id) : [...home.hidden, id] });
  return (
    <>
      <AdminPanel title="Inicio de la tienda" icon="panel-left" meta="Orden y secciones visibles">
        <p className="admin-field-hint">Elegí en qué orden salen las secciones del inicio y cuáles se muestran. Arrastralas o usá «Subir» y «Bajar». Una sección sin contenido (por ejemplo, Destacados sin productos marcados) no se dibuja sola.</p>
        <ol className="admin-order" aria-label="Secciones del inicio, en orden" data-testid="home-order">
          {home.order.map((id, index) => (
            <li
              key={id}
              className="admin-order-section"
              data-dragging={drag === id ? "true" : undefined}
              draggable={!disabled}
              onDragStart={(event) => { if (disabled) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); setDrag(id); }}
              onDragOver={(event) => { if (drag) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); if (drag) onHome({ ...home, order: moveSectionTo(home.order, drag, id) }); setDrag(null); }}
              onDragEnd={() => setDrag(null)}
            >
              <div className="admin-order-row">
                <span className="admin-order-pos" aria-hidden="true">{index + 1}</span>
                <strong className="admin-order-name">{HOME_SECTION_LABEL[id]}</strong>
                {hidden.has(id) ? <span className="admin-cell-sub">Oculta</span> : null}
                <span className="admin-order-actions">
                  <AdminButton type="button" aria-label={`Subir la sección ${HOME_SECTION_LABEL[id]}`} disabled={disabled || index === 0} onClick={() => onHome({ ...home, order: moveSection(home.order, id, -1) })}>↑ Subir</AdminButton>
                  <AdminButton type="button" aria-label={`Bajar la sección ${HOME_SECTION_LABEL[id]}`} disabled={disabled || index === home.order.length - 1} onClick={() => onHome({ ...home, order: moveSection(home.order, id, 1) })}>↓ Bajar</AdminButton>
                  {HOME_LOCKED.includes(id) ? (
                    <span className="admin-cell-sub">Siempre visible</span>
                  ) : (
                    <SwitchField ariaLabel={`Mostrar la sección ${HOME_SECTION_LABEL[id]}`} checked={!hidden.has(id)} disabled={disabled} onChange={(checked) => toggle(id, checked)} />
                  )}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </AdminPanel>

      <AdminPanel title="Bloque editorial" icon="edit" meta="Foto a un lado y texto al otro, dentro de «Editorial y colecciones»">
        <p className="admin-field-hint">Sin título ni texto, el bloque no se muestra.</p>
        <div className="admin-settings-grid">
          <TextField label="Rótulo (arriba del título)" value={home.editorial.eyebrow} maxLength={HOME_LIMITS.eyebrow} placeholder="Ej.: Colección del mes" disabled={disabled} onChange={(value) => onHome({ ...home, editorial: { ...home.editorial, eyebrow: value } })} />
          <TextField label="Título" value={home.editorial.title} maxLength={HOME_LIMITS.title} placeholder="Ej.: Mesas que se sienten" hint="La última palabra se dibuja con la letra manuscrita del tema, si la tiene." disabled={disabled} onChange={(value) => onHome({ ...home, editorial: { ...home.editorial, title: value } })} />
          <TextField label="Texto del botón" value={home.editorial.cta} maxLength={HOME_LIMITS.cta} placeholder="Ej.: Ver colecciones" hint="Vacío, dice «Ver el catálogo»." disabled={disabled} onChange={(value) => onHome({ ...home, editorial: { ...home.editorial, cta: value } })} />
        </div>
        <TextAreaField label="Texto" value={home.editorial.text} maxLength={HOME_LIMITS.text} disabled={disabled} onChange={(value) => onHome({ ...home, editorial: { ...home.editorial, text: value } })} />
        <PhotoBox slot="editorial" state={photos.editorial} version={versions.editorial} disabled={disabled} onChange={(next) => setPhoto("editorial", next)} />
      </AdminPanel>

      <AdminPanel title="Inspiración" icon="image" meta={`Hasta ${INSPIRATION_SLOTS} fotos de ambientación, cada una con su texto`}>
        <p className="admin-field-hint">Fotos de eventos o ambientes armados. Sin ninguna foto, la sección no se muestra.</p>
        <TextField label="Título de la sección" value={home.inspiration.title} maxLength={HOME_LIMITS.inspirationTitle} placeholder="Ej.: Ideas para tu evento" hint="Vacío, dice «Ideas para tu evento»." disabled={disabled} onChange={(value) => onHome({ ...home, inspiration: { ...home.inspiration, title: value } })} />
        <div className="admin-settings">
          {(["inspiracion-1", "inspiracion-2", "inspiracion-3"] as const).map((slot, index) => (
            <div key={slot} className="admin-settings">
              <PhotoBox slot={slot} state={photos[slot]} version={versions[slot]} disabled={disabled} onChange={(next) => setPhoto(slot, next)} />
              <TextField
                label={`Texto de la foto ${index + 1}`}
                value={home.inspiration.captions[index] ?? ""}
                maxLength={HOME_LIMITS.caption}
                placeholder="Opcional"
                disabled={disabled}
                onChange={(value) => onHome({ ...home, inspiration: { ...home.inspiration, captions: home.inspiration.captions.map((caption, at) => (at === index ? value : caption)) } })}
              />
            </div>
          ))}
        </div>
      </AdminPanel>
    </>
  );
}
