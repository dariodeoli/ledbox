"use client";

import { useEffect, useMemo, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { moveId, moveIdBefore } from "@/lib/storefront-order";
import type { StorefrontOrderView } from "@/lib/server/storefront-order";
import { AdminButton, AdminDataState, AdminNote, AdminPanel } from "../AdminUI";

/**
 * Ajustes → Tienda web → «Orden del catálogo»: la empresa decide en qué orden salen las secciones
 * (categorías) y los productos dentro de cada sección. Se arrastra (patrón del tablero del panel)
 * o se usa «Subir / Bajar», que es la vía accesible por teclado: el arrastre nunca es la única.
 * Nada se guarda hasta apretar «Guardar orden». El servidor valida que todo sea de la empresa.
 */

type Order = { sections: string[]; items: Record<string, string[]> };

const orderOf = (data: StorefrontOrderView): Order => ({
  sections: data.sections.map((section) => section.categoryId),
  items: Object.fromEntries(data.sections.map((section) => [section.categoryId, section.items.map((item) => item.id)])),
});

export function StoreOrderPanel({ readOnly }: { readOnly: boolean }) {
  const resource = useAdminResource("/api/admin/storefront/order", (payload) => payload as unknown as StorefrontOrderView);
  const data = resource.data;
  const initial = useMemo(() => (data ? orderOf(data) : null), [data]);
  const [order, setOrder] = useState<Order | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ kind: "section" | "item"; id: string; section?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (initial) setOrder(initial);
  }, [initial]);

  const sectionById = useMemo(() => new Map((data?.sections ?? []).map((section) => [section.categoryId, section])), [data]);
  const itemById = useMemo(() => new Map((data?.sections ?? []).flatMap((section) => section.items.map((item) => [item.id, item] as const))), [data]);
  const dirty = Boolean(order && initial && JSON.stringify(order) !== JSON.stringify(initial));

  function moveSection(id: string, delta: -1 | 1) {
    setNotice("");
    setOrder((current) => (current ? { ...current, sections: moveId(current.sections, id, delta) } : current));
  }
  function moveItem(sectionId: string, id: string, delta: -1 | 1) {
    setNotice("");
    setOrder((current) => (current ? { ...current, items: { ...current.items, [sectionId]: moveId(current.items[sectionId] ?? [], id, delta) } } : current));
  }
  function dropSection(target: string) {
    if (drag?.kind !== "section") return;
    setOrder((current) => (current ? { ...current, sections: moveIdBefore(current.sections, drag.id, target) } : current));
    setDrag(null);
  }
  function dropItem(sectionId: string, target: string) {
    if (drag?.kind !== "item" || drag.section !== sectionId) return;
    setOrder((current) => (current ? { ...current, items: { ...current.items, [sectionId]: moveIdBefore(current.items[sectionId] ?? [], drag.id, target) } } : current));
    setDrag(null);
  }

  async function save() {
    if (!order || busy || !dirty) return;
    setBusy(true);
    setError("");
    setNotice("");
    const result = await adminSend("/api/admin/storefront/order", { sections: order.sections.map((categoryId) => ({ categoryId, itemIds: order.items[categoryId] ?? [] })) }, "PATCH");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Guardamos el orden: ya se ve así en la tienda y en el catálogo mayorista.");
    resource.reload();
  }

  const empty = data && data.sections.length === 0 && data.unassigned.length === 0;

  return (
    <AdminPanel title="Orden del catálogo" icon="inventory" meta="Lo decide la empresa">
      <p className="admin-field-hint">
        Elegí en qué orden salen las secciones de la tienda y los productos dentro de cada una. Arrastralos o usá «Subir» y «Bajar». Lo que no ordenes
        queda al final, por nombre.
      </p>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} rows={3}>
        {empty ? <p className="admin-muted">Todavía no publicaste productos en la tienda. Marcalos como «Cliente final», «Mayorista» o «Ambos» en Inventario.</p> : null}
        {order && data ? (
          <ol className="admin-order" aria-label="Secciones de la tienda, en orden" data-testid="store-order">
            {order.sections.map((sectionId, index) => {
              const section = sectionById.get(sectionId);
              if (!section) return null;
              const ids = order.items[sectionId] ?? [];
              const expanded = open === sectionId;
              return (
                <li
                  key={sectionId}
                  className="admin-order-section"
                  data-dragging={drag?.kind === "section" && drag.id === sectionId ? "true" : undefined}
                  draggable={!readOnly}
                  onDragStart={(event) => {
                    if (readOnly || (event.target as HTMLElement).closest(".admin-order-items")) return;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", sectionId);
                    setDrag({ kind: "section", id: sectionId });
                  }}
                  onDragOver={(event) => {
                    if (drag?.kind === "section") event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropSection(sectionId);
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <div className="admin-order-row">
                    <span className="admin-order-pos" aria-hidden="true">{index + 1}</span>
                    <strong className="admin-order-name">{section.name}</strong>
                    <span className="admin-cell-sub">{ids.length} {ids.length === 1 ? "producto" : "productos"}</span>
                    <span className="admin-order-actions">
                      <AdminButton type="button" aria-label={`Subir la sección ${section.name}`} disabled={readOnly || index === 0} onClick={() => moveSection(sectionId, -1)}>↑ Subir</AdminButton>
                      <AdminButton type="button" aria-label={`Bajar la sección ${section.name}`} disabled={readOnly || index === order.sections.length - 1} onClick={() => moveSection(sectionId, 1)}>↓ Bajar</AdminButton>
                      <AdminButton type="button" aria-expanded={expanded} aria-controls={`orden-${sectionId}`} onClick={() => setOpen(expanded ? null : sectionId)}>
                        {expanded ? "Ocultar productos" : "Ordenar productos"}
                      </AdminButton>
                    </span>
                  </div>
                  {expanded ? (
                    <ol className="admin-order-items" id={`orden-${sectionId}`} aria-label={`Productos de ${section.name}, en orden`}>
                      {ids.map((id, position) => {
                        const item = itemById.get(id);
                        if (!item) return null;
                        return (
                          <li
                            key={id}
                            className="admin-order-item"
                            data-dragging={drag?.kind === "item" && drag.id === id ? "true" : undefined}
                            draggable={!readOnly}
                            onDragStart={(event) => {
                              if (readOnly) return;
                              event.stopPropagation();
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", id);
                              setDrag({ kind: "item", id, section: sectionId });
                            }}
                            onDragOver={(event) => {
                              if (drag?.kind === "item" && drag.section === sectionId) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              dropItem(sectionId, id);
                            }}
                            onDragEnd={() => setDrag(null)}
                          >
                            <span className="admin-order-pos" aria-hidden="true">{position + 1}</span>
                            <span className="admin-order-name">{item.name}{item.sku ? <span className="admin-cell-sub"> · {item.sku}</span> : null}</span>
                            <span className="admin-order-actions">
                              <AdminButton type="button" aria-label={`Subir ${item.name}`} disabled={readOnly || position === 0} onClick={() => moveItem(sectionId, id, -1)}>↑ Subir</AdminButton>
                              <AdminButton type="button" aria-label={`Bajar ${item.name}`} disabled={readOnly || position === ids.length - 1} onClick={() => moveItem(sectionId, id, 1)}>↓ Bajar</AdminButton>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {data && data.unassigned.length > 0 ? (
          <p className="admin-field-hint">
            {data.unassigned.length} {data.unassigned.length === 1 ? "producto publicado no tiene" : "productos publicados no tienen"} categoría del árbol y salen al final, por nombre. Asignales una categoría en Inventario para ordenarlos.
          </p>
        ) : null}
        <div className="admin-settings-actions">
          <AdminButton type="button" variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={readOnly || !dirty} onClick={() => void save()}>
            Guardar orden
          </AdminButton>
          {dirty ? <AdminButton type="button" disabled={busy} onClick={() => { if (initial) setOrder(initial); setNotice(""); }}>Descartar cambios</AdminButton> : null}
        </div>
      </AdminDataState>
    </AdminPanel>
  );
}
