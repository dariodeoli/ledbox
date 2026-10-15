"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import { COLLECTION_DESCRIPTION_MAX, COLLECTION_NAME_MAX, COLLECTION_ITEMS_MAX } from "@/lib/collections";
import { moveId } from "@/lib/storefront-order";
import type { CollectionAdminView } from "@/lib/server/collections";
import { CheckboxField, FileField, NumberField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Ajustes → Tienda web → «Colecciones»: grupos con nombre que arma la empresa («Verde Bosque», «Colección Rayas»). Cada
 * una lleva nombre, descripción, foto de ambientación, orden, visibilidad y sus productos (se eligen y se ordenan con
 * «Subir / Bajar»). En la tienda salen en el inicio, en su propia página y como filtro del catálogo. Solo OWNER/ADMIN; el
 * API valida que todo sea de la empresa activa.
 */

type Product = { id: string; name: string; sku: string | null; category: string };
type Loaded = { collections: CollectionAdminView[]; products: Product[] };
type Draft = { id: string | null; name: string; description: string; visible: boolean; sortOrder: string; itemIds: string[]; imageVersion: string | null; photo: File | null; removePhoto: boolean };

const blank = (order: number): Draft => ({ id: null, name: "", description: "", visible: true, sortOrder: String(order), itemIds: [], imageVersion: null, photo: null, removePhoto: false });
const fromView = (view: CollectionAdminView): Draft => ({ id: view.id, name: view.name, description: view.description ?? "", visible: view.visible, sortOrder: String(view.sortOrder), itemIds: view.itemIds, imageVersion: view.imageVersion, photo: null, removePhoto: false });

export function CollectionsSettings({ readOnly }: { readOnly: boolean }) {
  const resource = useAdminResource("/api/admin/collections", (payload) => payload as unknown as Loaded);
  const data = resource.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const productById = useMemo(() => new Map((data?.products ?? []).map((product) => [product.id, product])), [data]);

  useEffect(() => {
    if (!draft?.photo) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(draft.photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.photo]);

  const candidates = useMemo(() => {
    if (!draft || !data) return [];
    const needle = filter.trim().toLowerCase();
    return data.products.filter((product) => !draft.itemIds.includes(product.id) && (!needle || `${product.name} ${product.sku ?? ""} ${product.category}`.toLowerCase().includes(needle))).slice(0, 40);
  }, [draft, data, filter]);

  function edit(next: Draft | null) {
    setDraft(next);
    setFilter("");
    setError("");
    setNotice("");
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const body = { name: draft.name, description: draft.description, visible: draft.visible, sortOrder: Number(draft.sortOrder || 0), itemIds: draft.itemIds };
    const saved = draft.id
      ? await adminSend<{ collection: CollectionAdminView }>(`/api/admin/collections/${encodeURIComponent(draft.id)}`, body, "PATCH")
      : await adminSend<{ collection: CollectionAdminView }>("/api/admin/collections", body, "POST");
    if (!saved.ok) {
      setBusy(false);
      setError(saved.error);
      return;
    }
    const id = saved.data.collection.id;
    // La foto va aparte (multipart): primero el guardado, que es lo que no se puede perder.
    if (draft.removePhoto && !draft.photo && draft.imageVersion) {
      const removed = await adminSend(`/api/admin/collections/${encodeURIComponent(id)}/image`, undefined, "DELETE");
      if (!removed.ok) setError(`Guardamos la colección, pero no pudimos quitar la foto: ${removed.error}`);
    }
    if (draft.photo) {
      const form = new FormData();
      form.append("file", draft.photo, draft.photo.name);
      const uploaded = await adminApiUpload(`/api/admin/collections/${encodeURIComponent(id)}/image`, form, { timeoutMs: 60_000 });
      if (!uploaded.ok) setError(`Guardamos la colección, pero la foto no se subió: ${uploaded.error}`);
    }
    setBusy(false);
    setNotice(`Guardamos «${saved.data.collection.name}». Ya se ve en la tienda.`);
    setDraft(null);
    resource.reload();
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    setConfirming(null);
    const result = await adminSend(`/api/admin/collections/${encodeURIComponent(id)}`, undefined, "DELETE");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Eliminamos la colección. Los productos siguen en el catálogo.");
    if (draft?.id === id) setDraft(null);
    resource.reload();
  }

  const nextOrder = ((data?.collections ?? []).reduce((max, entry) => Math.max(max, entry.sortOrder), 0)) + 10;
  const photoSrc = draft ? (draft.removePhoto ? null : previewUrl ?? (draft.id && draft.imageVersion ? `/api/admin/collections/${encodeURIComponent(draft.id)}/image?v=${encodeURIComponent(draft.imageVersion)}` : null)) : null;

  return (
    <AdminPanel title="Colecciones" icon="sparkles" meta="Ambientes con nombre, como «Verde Bosque»">
      <p className="admin-field-hint">Agrupá productos que combinan entre sí. En la tienda salen en el inicio, con su propia página, y como filtro del catálogo.</p>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={2}>
        {data ? (
          <div className="admin-settings" data-testid="colecciones">
            {data.collections.length === 0 && !draft ? <p className="admin-muted">Todavía no armaste ninguna colección.</p> : null}
            {data.collections.length > 0 ? (
              <ul className="admin-order" aria-label="Colecciones de la tienda">
                {data.collections.map((collection) => (
                  <li key={collection.id} className="admin-order-section">
                    <div className="admin-order-row">
                      <strong className="admin-order-name">{collection.name}</strong>
                      <span className="admin-cell-sub">{collection.itemIds.length} {collection.itemIds.length === 1 ? "producto" : "productos"}{collection.visible ? "" : " · oculta"}</span>
                      <span className="admin-order-actions">
                        <AdminButton type="button" disabled={readOnly || busy} onClick={() => edit(fromView(collection))} aria-label={`Editar la colección ${collection.name}`}>Editar</AdminButton>
                        {confirming === collection.id ? (
                          <>
                            <AdminButton type="button" variant="primary" disabled={busy} onClick={() => void remove(collection.id)}>Sí, eliminar</AdminButton>
                            <AdminButton type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</AdminButton>
                          </>
                        ) : (
                          <AdminButton type="button" icon="trash" disabled={readOnly || busy} onClick={() => setConfirming(collection.id)} aria-label={`Eliminar la colección ${collection.name}`}>Eliminar</AdminButton>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {!draft ? (
              <div className="admin-settings-actions">
                <AdminButton type="button" icon="plus" variant="primary" disabled={readOnly} onClick={() => edit(blank(nextOrder))}>Nueva colección</AdminButton>
              </div>
            ) : (
              <form className="admin-settings" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="coleccion-editor" aria-label={draft.id ? "Editar colección" : "Nueva colección"}>
                <h3 className="admin-form-group-title">{draft.id ? `Editar «${draft.name || "colección"}»` : "Nueva colección"}</h3>
                <div className="admin-settings-grid">
                  <TextField label="Nombre" required value={draft.name} maxLength={COLLECTION_NAME_MAX} placeholder="Ej.: Verde Bosque" onChange={(value) => setDraft({ ...draft, name: value })} />
                  <NumberField label="Orden" value={draft.sortOrder} maxLength={4} hint="Menor = primero en el inicio." onChange={(value) => setDraft({ ...draft, sortOrder: value })} />
                  <SwitchField label="Visible en la tienda" checked={draft.visible} onChange={(checked) => setDraft({ ...draft, visible: checked })} hint="Oculta, la colección no aparece ni como filtro ni como página." />
                </div>
                <TextAreaField label="Descripción" value={draft.description} maxLength={COLLECTION_DESCRIPTION_MAX} onChange={(value) => setDraft({ ...draft, description: value })} hint="Opcional. Sale en la página de la colección." />

                <div className="admin-cover-box">
                  <FileField
                    label="Foto de ambientación"
                    hint="JPG, PNG o WebP de hasta 2 MB. Opcional: sin foto se usa la de su primer producto."
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    maxBytes={2 * 1024 * 1024}
                    file={draft.photo}
                    onSelect={(file) => setDraft({ ...draft, photo: file, removePhoto: false })}
                  />
                  <div className="admin-cover-frame" style={{ aspectRatio: "4 / 3" }}>
                    {photoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoSrc} alt="Vista previa de la foto de ambientación" />
                    ) : (
                      <span>Sin foto de ambientación</span>
                    )}
                  </div>
                  {photoSrc ? <AdminButton type="button" icon="trash" onClick={() => setDraft({ ...draft, photo: null, removePhoto: true })}>Quitar la foto</AdminButton> : null}
                </div>

                <section aria-labelledby="coleccion-productos">
                  <h4 id="coleccion-productos" className="admin-form-group-title">Productos ({draft.itemIds.length})</h4>
                  {draft.itemIds.length === 0 ? <p className="admin-field-hint">Elegí al menos un producto abajo para que la colección se vea en la tienda.</p> : (
                    <ol className="admin-order-items" aria-label="Productos de la colección, en orden">
                      {draft.itemIds.map((id, index) => (
                        <li key={id} className="admin-order-item">
                          <span className="admin-order-pos" aria-hidden="true">{index + 1}</span>
                          <span className="admin-order-name">{productById.get(id)?.name ?? "Producto no publicado"}{productById.get(id)?.sku ? <span className="admin-cell-sub"> · {productById.get(id)!.sku}</span> : null}</span>
                          <span className="admin-order-actions">
                            <AdminButton type="button" aria-label={`Subir ${productById.get(id)?.name ?? "el producto"}`} disabled={index === 0} onClick={() => setDraft({ ...draft, itemIds: moveId(draft.itemIds, id, -1) })}>↑ Subir</AdminButton>
                            <AdminButton type="button" aria-label={`Bajar ${productById.get(id)?.name ?? "el producto"}`} disabled={index === draft.itemIds.length - 1} onClick={() => setDraft({ ...draft, itemIds: moveId(draft.itemIds, id, 1) })}>↓ Bajar</AdminButton>
                            <AdminButton type="button" icon="trash" aria-label={`Quitar ${productById.get(id)?.name ?? "el producto"} de la colección`} onClick={() => setDraft({ ...draft, itemIds: draft.itemIds.filter((other) => other !== id) })}>Quitar</AdminButton>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <TextField label="Buscar productos para sumar" value={filter} onChange={setFilter} placeholder="Nombre, código o categoría" hint={`Hasta ${COLLECTION_ITEMS_MAX} productos por colección.`} />
                  <ul className="admin-pick-list" aria-label="Productos para sumar">
                    {candidates.map((product) => (
                      <li key={product.id}>
                        <CheckboxField
                          checked={false}
                          disabled={draft.itemIds.length >= COLLECTION_ITEMS_MAX}
                          text={`${product.name}${product.sku ? ` · ${product.sku}` : ""}`}
                          onChange={(checked) => { if (checked) setDraft({ ...draft, itemIds: [...draft.itemIds, product.id] }); }}
                        />
                      </li>
                    ))}
                  </ul>
                  {candidates.length === 0 ? <p className="admin-field-hint">{filter ? "No hay productos publicados con ese texto." : "No quedan productos publicados para sumar."}</p> : null}
                </section>

                <div className="admin-settings-actions">
                  <AdminButton type="submit" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={readOnly || !draft.name.trim()}>Guardar colección</AdminButton>
                  <AdminButton type="button" disabled={busy} onClick={() => edit(null)}>Cancelar</AdminButton>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </AdminDataState>
    </AdminPanel>
  );
}
