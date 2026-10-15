"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import { prepareInventoryPhoto } from "@/lib/inventory-image";
import { TAGS_MAX, TAG_MAX_LENGTH, parseTags } from "@/lib/store-tags";
import { FileField, SwitchField, TextField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminDialogSection, AdminNote } from "../AdminUI";
import { AdminImageBox } from "../AdminImageBox";

/**
 * Ficha del producto → «Tienda web»: lo que el producto muestra en la tienda además de su ficha. Tres cosas, todas de
 * ESTA empresa: las **fotos** (la principal más hasta 8 extra, que se suben, se ordenan con Subir/Bajar y se quitan),
 * si es **Destacado** (sección Destacados del inicio) y sus **estilos o colores** (filtro del catálogo). Componente
 * propio: la foto principal y el resto de los datos se siguen editando en «Editar».
 */

type Photo = { id: string; position: number; alt: string | null; url: string };
type Loaded = { featured: boolean; tags: string[]; collections: Array<{ id: string; name: string }>; photos: Photo[]; maxPhotos: number };

export function ProductStorefrontPanel({ itemId, name, mainImageUrl, writable, onChanged }: { itemId: string; name: string; mainImageUrl: string | null; writable: boolean; onChanged?: () => void }) {
  const resource = useAdminResource(`/api/admin/inventory/${encodeURIComponent(itemId)}/tienda`, (payload) => payload as unknown as Loaded);
  const data = resource.data;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [featured, setFeatured] = useState(false);
  const [tagsText, setTagsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!data) return;
    setPhotos(data.photos);
    setFeatured(data.featured);
    setTagsText(data.tags.join(", "));
  }, [data]);

  const parsedTags = parseTags(tagsText);
  const dirty = Boolean(data) && (featured !== data!.featured || parsedTags.tags.join("|") !== data!.tags.join("|"));
  const max = data?.maxPhotos ?? 8;

  const upload = useCallback(async (file: File) => {
    setError("");
    setNotice("");
    setUploading(true);
    try {
      const prepared = await prepareInventoryPhoto(file);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const form = new FormData();
      form.append("file", prepared.photo.blob, prepared.photo.fileName);
      const result = await adminApiUpload<{ photo: Photo }>(`/api/admin/inventory/${encodeURIComponent(itemId)}/photos`, form, { timeoutMs: 60_000 });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPhotos((current) => [...current, result.data.photo]);
      setNotice("Sumamos la foto. Ya se ve en la tienda.");
      onChanged?.();
    } finally {
      setUploading(false);
    }
  }, [itemId, onChanged]);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length || busy) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    setPhotos(next);
    setBusy(true);
    setError("");
    setNotice("");
    const result = await adminSend<{ photos: Photo[] }>(`/api/admin/inventory/${encodeURIComponent(itemId)}/photos`, { ids: next.map((photo) => photo.id) }, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      resource.reload();
      return;
    }
    setPhotos(result.data.photos);
    setNotice("Guardamos el nuevo orden.");
  }

  async function remove(photoId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setConfirming(null);
    const result = await adminSend<{ photos: Photo[] }>(`/api/admin/inventory/${encodeURIComponent(itemId)}/photos/${encodeURIComponent(photoId)}`, undefined, "DELETE");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPhotos(result.data.photos);
    setNotice("Quitamos la foto.");
    onChanged?.();
  }

  async function saveAttributes() {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await adminSend<Loaded & { ignoredTags: string[] }>(`/api/admin/inventory/${encodeURIComponent(itemId)}/tienda`, { featured, tags: parsedTags.tags }, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Guardamos lo que muestra la tienda.");
    resource.reload();
    onChanged?.();
  }

  return (
    <AdminDialogSection title="Tienda web" stack hint="Fotos, destacado y estilos que se ven en la tienda de la empresa.">
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={2}>
        {data ? (
          <div className="admin-storefront-panel" data-testid="ficha-tienda">
            {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
            {error ? <AdminNote tone="error">{error}</AdminNote> : null}

            <section aria-labelledby={`fotos-${itemId}`} className="admin-photo-list-wrap">
              <h4 id={`fotos-${itemId}`} className="admin-form-group-title">Fotos</h4>
              <ul className="admin-photo-list" aria-label={`Fotos de ${name}`}>
                <li className="admin-photo-row" data-testid="photo-main">
                  <AdminImageBox imageUrl={mainImageUrl} size={56} title="Foto principal" />
                  <span className="admin-photo-meta"><strong>Foto principal</strong><span className="admin-field-hint">Es la primera de la galería. Se cambia en «Editar».</span></span>
                </li>
                {photos.map((photo, index) => (
                  <li key={photo.id} className="admin-photo-row" data-testid="photo-extra">
                    <AdminImageBox imageUrl={photo.url} size={56} title={`Foto ${index + 2}`} />
                    <span className="admin-photo-meta"><strong>Foto {index + 2}</strong></span>
                    {writable ? (
                      <span className="admin-photo-actions">
                        <AdminButton type="button" size="sm" disabled={busy || index === 0} onClick={() => void move(index, -1)} aria-label={`Subir la foto ${index + 2}`}>Subir</AdminButton>
                        <AdminButton type="button" size="sm" disabled={busy || index === photos.length - 1} onClick={() => void move(index, 1)} aria-label={`Bajar la foto ${index + 2}`}>Bajar</AdminButton>
                        {confirming === photo.id ? (
                          <>
                            <AdminButton type="button" size="sm" variant="primary" disabled={busy} onClick={() => void remove(photo.id)}>Sí, quitar</AdminButton>
                            <AdminButton type="button" size="sm" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</AdminButton>
                          </>
                        ) : (
                          <AdminButton type="button" size="sm" icon="trash" disabled={busy} onClick={() => setConfirming(photo.id)} aria-label={`Quitar la foto ${index + 2}`}>Quitar</AdminButton>
                        )}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {photos.length === 0 ? <p className="admin-field-hint">Todavía no hay fotos extra: la tienda muestra solo la principal.</p> : null}
              {writable ? (
                photos.length < max ? (
                  <FileField
                    label="Sumar una foto"
                    hint={`JPG, PNG o WebP; se comprime en el navegador (hasta 2 MB). Podés sumar ${max - photos.length} más.`}
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    maxBytes={10 * 1024 * 1024}
                    disabled={uploading || busy}
                    file={null}
                    onSelect={(file) => { if (file) void upload(file); }}
                  />
                ) : <AdminNote>Llegaste al máximo de fotos extra ({max}). Quitá una para sumar otra.</AdminNote>
              ) : null}
              {uploading ? <p className="admin-field-hint" role="status">Subiendo la foto…</p> : null}
            </section>

            <section aria-labelledby={`estilo-${itemId}`}>
              <h4 id={`estilo-${itemId}`} className="admin-form-group-title">Destacado y estilos</h4>
              <div className="admin-settings-grid">
                <SwitchField label="Destacado en el inicio" checked={featured} onChange={setFeatured} disabled={!writable} hint="Aparece en la sección «Destacados» del inicio de la tienda." />
                <TextField
                  label="Estilo o color"
                  value={tagsText}
                  onChange={(value) => { setTagsText(value); setNotice(""); }}
                  disabled={!writable}
                  maxLength={TAGS_MAX * (TAG_MAX_LENGTH + 2)}
                  placeholder="Ej.: Natural, Rattan, Verde"
                  hint={`Separá con comas (hasta ${TAGS_MAX}). Sirven para el filtro «Estilo o color» del catálogo.`}
                  error={parsedTags.ignored.length > 0 ? `Sin lugar o muy largo (${TAG_MAX_LENGTH} caracteres): ${parsedTags.ignored.join(", ")}.` : null}
                />
              </div>
              {data.collections.length > 0 ? <p className="admin-field-hint">En las colecciones: {data.collections.map((entry) => entry.name).join(", ")}. Se arman en Ajustes → Tienda web → Colecciones.</p> : null}
              {writable ? (
                <div className="admin-settings-actions">
                  <AdminButton type="button" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={!dirty || parsedTags.ignored.length > 0} onClick={() => void saveAttributes()}>Guardar</AdminButton>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </AdminDataState>
    </AdminDialogSection>
  );
}
