"use client";

import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/admin-format";
import type { AdminInventoryGridRow } from "@/lib/admin-types";
import { useInventoryGrid } from "./InventoryGridData";
import { useAdminNarrowViewport } from "../AdminBoard";
import { AdminButtonLink, AdminCell, AdminDataState, AdminEmpty, AdminModuleContext, AdminNote, AdminPanel, AdminRow, AdminTable } from "../AdminUI";
import { AdminCardGrid } from "../AdminCards";
import { SearchField } from "../AdminFields";
import { AdminImageBox } from "../AdminImageBox";

/** Vista privada del catálogo de venta. No activa tienda, pedidos ni stock comercial. */
export function CatalogoVentaModule() {
  const [query, setQuery] = useState("");
  const narrow = useAdminNarrowViewport();
  const resource = useInventoryGrid({ from: "", to: "" }, { saleCatalogOnly: true });
  const products = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    const rows = (resource.data ?? []) as Array<AdminInventoryGridRow & { familyName?: string | null; familyCode?: string | null }>;
    return text ? rows.filter((item) => [item.name, item.category, item.sku, item.familyName, item.familyCode].some((value) => value?.toLocaleLowerCase().includes(text))) : rows;
  }, [resource.data, query]);
  const cards = products.map((item) => ({
    id: item.id,
    title: item.name,
    titleTooltip: item.name,
    subtitle: `${item.category}${item.sku ? ` · SKU ${item.sku}` : ""}`,
    identity: <AdminImageBox imageUrl={item.imageUrl} size={64} />,
    badges: [{ label: "Venta", tone: "info" as const }],
    fields: [
      { label: "Precio de venta", value: "Pendiente de configurar" },
      { label: "Familia / variantes", value: item.familyName ?? "Sin familia" },
    ],
    footer: <AdminButtonLink icon="edit" href={`/inventario?producto=${encodeURIComponent(item.id)}`}>Abrir ficha</AdminButtonLink>,
  }));

  return (
    <div className="admin-module-page">
      <AdminModuleContext
        breadcrumb="Ventas / Catálogo de venta"
        hint="Prepará los productos que se podrán cotizar para venta. Esta lista interna no altera el catálogo ni las reservas de alquiler."
        meta={resource.data ? `${formatNumber(resource.total ?? products.length)} productos` : undefined}
      />
      <AdminPanel title="Catálogo de venta" meta="Interno · separado del alquiler" icon="inventory">
        <AdminNote>Esta pantalla organiza productos marcados para venta. Los precios de alquiler no se presentan como precios de venta. La tienda pública, el carrito y el stock de venta requieren su flujo propio.</AdminNote>
        <SearchField value={query} onChange={setQuery} label="Buscar productos de venta" placeholder="Nombre, SKU, categoría o variante…" />
        <AdminDataState
          loading={resource.loading && !resource.data}
          error={resource.error}
          onRetry={resource.reload}
          empty={resource.data?.length === 0}
          emptyTitle="Todavía no hay productos de venta"
          emptyIcon="inventory"
          emptyHint="Abrí un producto en Inventario y activá «Incluir en el catálogo de venta». Esto no lo publica ni modifica su disponibilidad de alquiler."
        >
          {products.length === 0 ? <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro nombre, SKU o categoría." /> : narrow ? (
            <AdminCardGrid label="Productos del catálogo interno de venta" cards={cards} />
          ) : (
            <AdminTable
              view="catalogo-venta"
              label="Productos del catálogo interno de venta"
              columns={[{ label: "Foto" }, { label: "Producto" }, { label: "Categoría / familia" }, { label: "Precio" }, { label: "Acción", end: true }]}
            >
              {products.map((item) => (
                <AdminRow key={item.id}>
                  <AdminCell><AdminImageBox imageUrl={item.imageUrl} size={36} /></AdminCell>
                  <AdminCell title={item.sku ? `${item.name} · SKU ${item.sku}` : item.name}>
                    <strong>{item.name}</strong>
                    {item.sku ? <small className="admin-cell-sub">SKU {item.sku}</small> : null}
                  </AdminCell>
                  <AdminCell title={item.category}>{item.category}{item.familyName ? ` · ${item.familyName}` : ""}</AdminCell>
                  <AdminCell><span className="admin-muted">Pendiente de configurar</span></AdminCell>
                  <AdminCell end><AdminButtonLink icon="edit" href={`/inventario?producto=${encodeURIComponent(item.id)}`}>Abrir ficha</AdminButtonLink></AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          )}
        </AdminDataState>
      </AdminPanel>
    </div>
  );
}
