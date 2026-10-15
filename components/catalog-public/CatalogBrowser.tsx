"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  catalogLine,
  catalogTierHints,
  estimatedSubtotal,
  type AvailabilityHint,
  type CatalogPrice,
} from "@/lib/catalog-public";
import type { PriceMode } from "@/lib/appearance";
import { legacyTier, packageSummary, type PackageSummary } from "@/lib/price-tiers";
import { readLocalStoreCart, sanitizeStoreCart, storeCartKey, writeLocalStoreCart, type StoreCartState } from "@/lib/store-cart";
import type { CartView } from "@/lib/server/store-cart";
import { MAX_QUANTITY, formatGs, priceUnitLabel, quantityStep, sortCatalog, todayKeyPY, type SortKey } from "@/lib/storefront-ui";
import { cardSpecs } from "@/lib/catalog-card";
import { CartDrawer, type Done } from "./CartDrawer";
import { FiltersDrawer, FiltersPanel } from "./StoreFilters";
import { EMPTY_FILTERS, activeFilterCount, capacityOptions, matchesFilters, type StoreFilters } from "@/lib/store-filters";
import { collectTags } from "@/lib/store-tags";
import { ContactPanel } from "./ContactPanel";
import { EventPicker } from "./EventPicker";
import { FilterBar } from "./FilterBar";
import { OrderBar } from "./OrderBar";
import { ProductTile } from "./ProductTile";
import { QuickView, type QuickPrice } from "./QuickView";
import { EmptyState } from "./StoreStates";
import { useStoreToast } from "./StoreToast";
import { ThemePortal } from "./ThemePortal";

/**
 * Catálogo de la tienda web de una empresa, carrito y armado de la preorden (sin
 * cuenta). Lo usan la tienda pública (cliente final) y el catálogo mayorista (link
 * privado): cambia solo la lista de precios y el endpoint del pedido.
 * La preorden NO es una reserva: la pantalla final lo dice con todas las letras.
 */

export type CatalogItemView = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  imageUrl: string | null;
  description?: string | null;
  capacity?: number | null;
  dimensions?: string | null;
  price: CatalogPrice | null;
  availability: AvailabilityHint | null;
  /** Fotos extra (después de `imageUrl`), estilos para filtrar, «destacado» y slugs de las colecciones del producto. */
  gallery?: string[];
  tags?: string[];
  featured?: boolean;
  collections?: string[];
  /** Paquete (combo): sus piezas con precio, para mostrar la suma por unidad y el ahorro. */
  package?: Array<{ name: string; quantity: number; price: CatalogPrice }> | null;
};

/** Zona de flete que ve el público; sin precios si la tienda no muestra precios. */
export type CatalogZoneView = { id: string; name: string; basePrice: number; volumeThreshold: number | null; extraPrice: number | null };

type Props = {
  organizationName: string;
  showPrices: boolean;
  /** Endpoint de la preorden: el público o el del link mayorista. */
  preorderPath: string;
  wholesale: boolean;
  /** Cliente del link mayorista (solo se muestra en el pedido). */
  clientName: string | null;
  demo: boolean;
  items: CatalogItemView[];
  range: { fromKey: string; toKey: string; days: number } | null;
  initialCategory: string | null;
  zones?: CatalogZoneView[];
  /** Modo de precio de la empresa: por día, por unidad (c/u, de a 10) o a cotizar. */
  priceMode?: PriceMode;
  /** Slug de la empresa y tipo de acceso: separan el carrito guardado de cada tienda. */
  slug: string;
  cartScope?: "public" | "acceso" | "mayorista" | "visitor";
  /** Cliente con acceso aprobado (o enlace mágico): el carrito también se guarda en el servidor (retomar desde otro dispositivo). */
  savedCart?: boolean;
  /** Endpoint del carrito; por defecto el de `preorderPath`. */
  cartPath?: string;
  /** Base de las fichas de producto (`<base>/p/<id>`) y nombre de la tienda (mensaje del enlace mágico). */
  fichaBase?: string;
  storeName?: string;
  /** Colecciones para el filtro (solo las visibles con productos) y la que viene elegida desde un link. */
  collections?: Array<{ slug: string; name: string }>;
  initialCollection?: string | null;
};

const money = formatGs;
const PAGE_SIZE = 24;

const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Suma por unidad de las piezas del paquete y ahorro, con la misma regla de días de cada pieza. */
function packageOf(item: CatalogItemView, days: number): PackageSummary | null {
  if (!item.price || !item.package?.length) return null;
  const product = { basePrice: item.price.unit, billingUnit: item.price.perEvent ? "EVENT" : null, tiers: item.price.tiers ?? legacyTier(item.price.fromDays, item.price.fromPrice) };
  const components = item.package.map((part) => ({
    name: part.name,
    quantity: part.quantity,
    base: part.price.unit,
    minimum: 0,
    billingUnit: part.price.perEvent ? ("EVENT" as const) : ("DAILY" as const),
    tiers: part.price.tiers ?? legacyTier(part.price.fromDays, part.price.fromPrice),
  }));
  return packageSummary(product, components, days);
}

/** `COD #527` a partir del SKU (sin repetir «COD» si el SKU ya lo trae). */
const codeOf = (sku: string) => `COD #${sku.replace(/^cod\s*#?\s*/i, "")}`;

/** «2 × Sofá p/2 + 4 × Sillón + Mesa baja»: las piezas del juego, tal como las cargó la empresa. */
const piecesText = (parts: NonNullable<CatalogItemView["package"]>) => parts.map((part) => (part.quantity > 1 ? `${part.quantity} × ${part.name}` : part.name)).join(" + ");

type CartSnapshot = { items: Array<{ id: string; quantity: number }>; from: string | null; to: string | null; zone: string };

export function CatalogBrowser({ organizationName, showPrices, preorderPath, wholesale, clientName, demo, items, range, initialCategory, zones = [], priceMode = "day", slug, cartScope = "public", savedCart = false, cartPath: cartPathProp, fichaBase, storeName, collections = [], initialCollection = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  // Visitante identificado: su carrito vive en el servidor bajo su enlace mágico (el token se guarda solo en este navegador).
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const cartPath = cartPathProp ?? (visitorToken ? `/api/catalog/${encodeURIComponent(slug)}/carrito/${visitorToken}/cart` : preorderPath.replace(/\/preorder$/, "/cart"));
  const saved = savedCart || Boolean(visitorToken);
  const cartKey = storeCartKey(slug, cartScope === "visitor" ? "public" : cartScope);
  const visitorKey = `ledbox-store-visitor:${slug.trim().toLowerCase()}`;
  const [contactOpen, setContactOpen] = useState(false);
  const [quickId, setQuickId] = useState<string | null>(null);
  const contactAsked = useRef(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(initialCategory && items.some((item) => item.category === initialCategory) ? initialCategory : null);
  const [sort, setSort] = useState<SortKey>("destacados");
  const [filters, setFilters] = useState<StoreFilters>(() => ({ ...EMPTY_FILTERS, collection: initialCollection && collections.some((entry) => entry.slug === initialCollection) ? initialCollection : null }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [revalidateFailed, setRevalidateFailed] = useState(false);
  const { toast, show: showToast } = useStoreToast();
  const [selection, setSelection] = useState<Record<string, number>>({});
  // Flete: "" = no elegí, COORDINATE = «a coordinar», o el id de una zona (vive acá para guardarse con el carrito).
  const [zoneChoice, setZoneChoice] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<CartView | null>(null);
  const [cartNotice, setCartNotice] = useState("");
  const seenTotal = useRef<number | null>(null);

  // Un link de categoría (`?categoria=`) también mueve el filtro cuando ya se estaba en la página.
  useEffect(() => {
    if (initialCategory && items.some((item) => item.category === initialCategory)) setCategory(initialCategory);
  }, [initialCategory, items]);

  // Carrito persistente: al abrir la tienda se retoma el del navegador (con try/catch) y, si el cliente
  // tiene acceso aprobado, el del servidor (para seguir desde otro dispositivo). Nada se confía: los
  // precios y el stock se vuelven a calcular en el servidor (efecto de revalidación de abajo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let state: StoreCartState = readLocalStoreCart(cartKey);
      let path = cartPath;
      let hasServerCart = savedCart;
      if (!savedCart && cartScope === "public") {
        try {
          const token = window.localStorage.getItem(visitorKey);
          if (token) {
            path = `/api/catalog/${encodeURIComponent(slug)}/carrito/${token}/cart`;
            hasServerCart = true;
            if (!cancelled) setVisitorToken(token);
          }
        } catch {
          /* almacenamiento no disponible: carrito solo local */
        }
      }
      if (hasServerCart) {
        try {
          const response = await fetch(path, { cache: "no-store" });
          if (response.ok) {
            const server = sanitizeStoreCart(((await response.json()) as { cart?: unknown }).cart);
            if (server.items.length > 0 || state.items.length === 0) state = server;
          } else if (response.status === 404 && path !== cartPath) {
            // El enlace del visitante venció o ya no existe: sigue el carrito del navegador, sin servidor.
            try { window.localStorage.removeItem(visitorKey); } catch { /* sin almacenamiento */ }
            if (!cancelled) setVisitorToken(null);
          }
        } catch (error) {
          console.error("tienda: no se pudo leer el carrito guardado; queda el del navegador", error);
        }
      }
      if (cancelled) return;
      const known = new Set(items.map((item) => item.id));
      const kept = state.items.filter((line) => known.has(line.id));
      const notices: string[] = [];
      if (kept.length < state.items.length) notices.push(`Quitamos ${state.items.length - kept.length} ${state.items.length - kept.length === 1 ? "producto" : "productos"} de tu carrito porque ya no están en el catálogo.`);
      setSelection(Object.fromEntries(kept.map((line) => [line.id, line.quantity])));
      setZoneChoice(state.zone === "COORDINATE" || zones.some((zone) => zone.id === state.zone) ? state.zone : "");
      seenTotal.current = kept.length > 0 ? state.seenTotal : null;
      if (kept.length > 0 && !range && state.from && state.to) {
        if (state.to >= todayKeyPY()) {
          const shared = new URLSearchParams(window.location.search).get("p");
          const extra = `${initialCategory ? `&categoria=${encodeURIComponent(initialCategory)}` : ""}${shared ? `&p=${encodeURIComponent(shared)}` : ""}`;
          router.replace(`${pathname}?desde=${encodeURIComponent(state.from)}&hasta=${encodeURIComponent(state.to)}${extra}${window.location.hash || "#catalogo"}`, { scroll: false });
        } else {
          notices.push("Las fechas que habías elegido ya pasaron: elegí fechas nuevas para ver la disponibilidad.");
        }
      }
      if (notices.length > 0) setCartNotice(notices.join(" "));
      setReady(true);
    })();
    return () => { cancelled = true; };
    // Solo al montar: después el carrito manda el estado de esta pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category))], [items]);
  const days = range?.days ?? 1;
  const capacities = useMemo(() => capacityOptions(items), [items]);
  const allTags = useMemo(() => collectTags(items.map((item) => item.tags ?? [])), [items]);
  const visible = useMemo(() => {
    const needle = norm(query.trim());
    return items.filter((item) => {
      if (category && item.category !== category) return false;
      if (needle && !norm(`${item.name} ${item.sku ?? ""} ${item.category} ${item.description ?? ""} ${(item.tags ?? []).join(" ")}`).includes(needle)) return false;
      return matchesFilters(item, filters, { unit: item.price ? catalogLine(item.price, days).unitPrice : 0, capacities });
    });
  }, [items, query, category, filters, capacities, days]);
  const changeFilters = useCallback((next: StoreFilters) => { setFilters(next); setShown(PAGE_SIZE); }, []);
  const filterProps = { filters, onChange: changeFilters, capacities, tags: allTags, collections, showPrices, hasRange: Boolean(range), resultCount: visible.length };
  const chosen = items.filter((item) => (selection[item.id] ?? 0) > 0);
  // Misma regla de días que el presupuesto (escalones por día o total, evento): `lib/price-tiers.ts`.
  const pricingFor = (item: CatalogItemView) => (item.price ? catalogLine(item.price, days) : null);
  const unitFor = (item: CatalogItemView) => pricingFor(item)?.unitPrice ?? 0;
  const lines = chosen.map((item) => {
    const pricing = pricingFor(item);
    return { name: item.name, quantity: selection[item.id], unitPrice: unitFor(item) || null, perEvent: pricing ? pricing.mode === "TOTAL" || pricing.mode === "EVENT" : false };
  });
  const localSubtotal = showPrices && range ? estimatedSubtotal(lines, days) : null;
  // Con la revalidación del servidor, el subtotal es el SUYO (precio y stock de hoy); sin red queda el local.
  const subtotal = showPrices && range ? (view ? view.itemsSubtotal : localSubtotal) : null;
  const count = chosen.reduce((sum, item) => sum + (selection[item.id] ?? 0), 0);
  // El encabezado de la tienda (otro componente) muestra el contador y abre el pedido: se hablan por eventos del navegador.
  useEffect(() => {
    (window as unknown as { __cpCartCount?: number }).__cpCartCount = count;
    window.dispatchEvent(new CustomEvent("cp:cart-count", { detail: count }));
  }, [count]);
  useEffect(() => {
    const openCart = () => { if (count > 0) { setDone(null); setOpen(true); } else document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
    window.addEventListener("cp:open-cart", openCart);
    return () => window.removeEventListener("cp:open-cart", openCart);
  }, [count]);
  const selectionKey = chosen.map((item) => `${item.id}:${selection[item.id]}`).join("|");
  const currentState = (): CartSnapshot => ({ items: chosen.map((item) => ({ id: item.id, quantity: selection[item.id] })), from: range?.fromKey ?? null, to: range?.toKey ?? null, zone: zoneChoice });

  // Guardar el carrito: siempre en el navegador; con acceso aprobado, también en el servidor (sin precios).
  useEffect(() => {
    if (!ready) return;
    const state: CartSnapshot & { seenTotal: number | null } = {
      items: chosen.map((item) => ({ id: item.id, quantity: selection[item.id] })),
      from: range?.fromKey ?? null,
      to: range?.toKey ?? null,
      zone: zoneChoice,
      seenTotal: view?.total ?? seenTotal.current,
    };
    writeLocalStoreCart(cartKey, state);
    if (!saved) return;
    const timer = setTimeout(() => {
      fetch(cartPath, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch((error) => {
        console.error("tienda: no se pudo guardar el carrito en el servidor", error);
      });
    }, 800);
    return () => clearTimeout(timer);
    // `chosen` y `selection` se resumen en `selectionKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectionKey, range?.fromKey, range?.toKey, zoneChoice, view?.total, saved, cartPath]);

  // Primer producto sin identificar (tienda abierta): se ofrece guardar el carrito dejando el contacto. Una sola vez por visita.
  useEffect(() => {
    if (!ready || contactAsked.current || count === 0 || saved || cartScope !== "public" || quickId || open) return;
    contactAsked.current = true;
    try {
      if (window.sessionStorage.getItem(`${visitorKey}:skip`)) return;
    } catch {
      /* sin almacenamiento: se ofrece igual */
    }
    setContactOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, count, saved, cartScope, quickId, open]);

  // Revalidar al volver y al cambiar el carrito: el servidor devuelve precio, escalón, flete, total y stock de HOY.
  useEffect(() => {
    if (!ready || chosen.length === 0) {
      setView(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(cartPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: chosen.map((item) => ({ id: item.id, quantity: selection[item.id] })), from: range?.fromKey ?? null, to: range?.toKey ?? null, zone: zoneChoice }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = ((await response.json()) as { cart: CartView }).cart;
        const notices: string[] = [];
        if (next.removed.length > 0) {
          notices.push(`Quitamos ${next.removed.length} ${next.removed.length === 1 ? "producto" : "productos"} de tu carrito porque ya no están en el catálogo.`);
          setSelection((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !next.removed.includes(id))));
        }
        if (next.delivery.gone) {
          notices.push("La zona de flete que elegiste ya no está disponible: elegí otra o dejá «A coordinar».");
          setZoneChoice("");
        }
        if (next.total !== null && seenTotal.current !== null && seenTotal.current !== next.total) {
          notices.push(`El total cambió: antes ${money(seenTotal.current)}, ahora ${money(next.total)}. Los precios se calculan al día; la cotización los confirma.`);
        }
        if (next.total !== null) seenTotal.current = next.total;
        if (notices.length > 0) setCartNotice(notices.join(" "));
        setView(next);
        setRevalidateFailed(false);
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        console.error("tienda: no se pudo revalidar el carrito; se muestran los precios del catálogo", error);
        setRevalidateFailed(true);
        setView(null);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
    // `chosen` y `selection` se resumen en `selectionKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectionKey, range?.fromKey, range?.toKey, zoneChoice, cartPath]);

  /** Fechas elegidas en el pedido: se aplican a toda la tienda (la dirección las lleva al servidor, que calcula la disponibilidad). */
  function applyRange(next: { fromKey: string; toKey: string }) {
    const params = new URLSearchParams(window.location.search);
    params.set("desde", next.fromKey);
    params.set("hasta", next.toKey);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  }
  const setQuantity = useCallback((id: string, next: number) => {
    setSelection((current) => {
      const copy = { ...current };
      if (next <= 0) delete copy[id];
      else copy[id] = Math.min(MAX_QUANTITY, next);
      return copy;
    });
  }, []);

  // Vista rápida: popup con la ficha. La URL lleva `?p=<id>` (se puede compartir), «atrás» lo cierra y el catálogo
  // de atrás no se mueve (ni el scroll ni el carrito).
  const pushedQuick = useRef(false);
  const quickItem = quickId ? items.find((entry) => entry.id === quickId) ?? null : null;
  const quickUrl = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("p", id);
    else url.searchParams.delete("p");
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const openQuick = useCallback((id: string) => {
    try {
      window.history.pushState(window.history.state, "", quickUrl(id));
      pushedQuick.current = true;
    } catch (failure) {
      console.error("tienda: no se pudo actualizar la dirección de la vista rápida", failure);
      pushedQuick.current = false;
    }
    setQuickId(id);
  }, []);
  // Destacados usa la misma vista rápida y el mismo carrito que el catálogo. El enlace conserva la ficha como respaldo.
  useEffect(() => {
    const openFeatured = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-store-product]") : null;
      const id = link?.dataset.storeProduct;
      if (!id || !items.some((item) => item.id === id)) return;
      event.preventDefault();
      openQuick(id);
    };
    document.addEventListener("click", openFeatured);
    return () => document.removeEventListener("click", openFeatured);
  }, [items, openQuick]);
  const navigateQuick = useCallback((id: string) => {
    try { window.history.replaceState(window.history.state, "", quickUrl(id)); } catch (failure) { console.error("tienda: no se pudo actualizar la dirección de la vista rápida", failure); }
    setQuickId(id);
  }, []);
  const closeQuick = useCallback(() => {
    if (pushedQuick.current) { window.history.back(); return; }
    try { window.history.replaceState(window.history.state, "", quickUrl(null)); } catch (failure) { console.error("tienda: no se pudo actualizar la dirección al cerrar la vista rápida", failure); }
    setQuickId(null);
  }, []);
  const addFromQuick = useCallback((id: string, quantity: number) => {
    setSelection((current) => ({ ...current, [id]: Math.min(MAX_QUANTITY, (current[id] ?? 0) + quantity) }));
  }, []);
  // Enlace compartido (`?p=<id>`) y botón «atrás» del navegador.
  useEffect(() => {
    const sync = () => {
      const id = new URLSearchParams(window.location.search).get("p");
      if (!id) pushedQuick.current = false;
      setQuickId(id && items.some((entry) => entry.id === id) ? id : null);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [items]);

  // Precio, ahorro y escalones de un producto para los días elegidos (tarjeta y vista rápida usan lo mismo).
  const priceOf = (item: CatalogItemView): QuickPrice => {
    const unit = unitFor(item);
    const pack = showPrices && unit > 0 && item.package ? packageOf(item, days) : null;
    const saving = pack && !pack.incomplete && pack.packageTotal > 0 && pack.savings > 0 ? { savings: pack.savings, unitSum: pack.unitSum } : null;
    return { unit, unitText: unit > 0 ? priceUnitLabel(priceMode, pricingFor(item)?.mode, range ? days : null) : "", tierHints: showPrices ? catalogTierHints(item.price) : [], saving };
  };

  // Orden y paginación: «Destacados» respeta el orden de la empresa por categoría; cualquier otro orden es una lista plana.
  const flat = sort !== "destacados";
  const ordered = useMemo(
    () => (flat ? sortCatalog(visible.map((item) => ({ item, name: item.name, capacity: item.capacity ?? null, unit: item.price ? catalogLine(item.price, days).unitPrice : 0 })), sort).map((row) => row.item) : visible),
    [flat, visible, sort, days],
  );
  const page = ordered.slice(0, shown);
  const pageGroups = useMemo(() => {
    const map = new Map<string, CatalogItemView[]>();
    for (const item of page) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [page]);
  const unitMode = priceMode === "unit";

  function renderItem(item: CatalogItemView) {
    const price = priceOf(item);
    const isPackage = Boolean(item.package?.length);
    return (
      <ProductTile
        key={item.id}
        item={item}
        specs={cardSpecs(item)}
        isPackage={isPackage}
        showPrices={showPrices}
        perUnit={unitMode}
        step={quantityStep(priceMode, isPackage)}
        unit={price.unit}
        unitText={price.unitText}
        saving={price.saving}
        tierHint={price.tierHints[0] ?? null}
        pieces={item.package?.length ? piecesText(item.package) : null}
        quantity={selection[item.id] ?? 0}
        fichaHref={fichaBase ? `${fichaBase}/p/${encodeURIComponent(item.id)}` : null}
        onOpen={openQuick}
        onQuantity={setQuantity}
        onAdd={addFromTile}
      />
    );
  }

  function addFromTile(id: string, quantity: number) {
    addFromQuick(id, quantity);
    showToast("Agregado al pedido", { label: "Ver pedido", onClick: () => { setDone(null); setOpen(true); } });
  }

  // Sin fechas la barra igual muestra plata: la suma por día (o por evento) × cantidad con los precios públicos ya cargados.
  const perDay = (() => {
    if (!showPrices || range) return null;
    let sum = 0, priced = 0, events = 0, missing = 0;
    for (const item of chosen) {
      const unit = unitFor(item);
      if (unit > 0) { sum += unit * (selection[item.id] ?? 0); priced += 1; if (item.price?.perEvent) events += 1; } else missing += 1;
    }
    if (priced === 0) return null;
    return { sum, missing, unit: events === priced ? "por evento" : events > 0 ? "por día o evento" : priceMode === "unit" ? "c/u" : "por día" };
  })();
  const barText = showPrices
    ? !range
      ? perDay ? `${money(perDay.sum)} ${perDay.unit} · elegí fechas para el total` : "Elegí fechas para el total"
      : view && view.total !== null ? `Total estimado ${money(view.total)}` : subtotal !== null ? `Subtotal estimado ${money(subtotal)}` : "Confirmamos el monto en la cotización"
    : null;

  return (
    <section id="catalogo" className="cp-section cp-catalog" aria-labelledby="catalogo-titulo">
      <div className="cp-section-head">
        <p className="cp-eyebrow">{wholesale ? "Catálogo mayorista" : "Catálogo de alquiler"}</p>
        <h2 id="catalogo-titulo" className="cp-h2">Elegí tus productos</h2>
        {wholesale ? <p className="cp-lead">Precios mayoristas, solo para vos{clientName ? ` (${clientName})` : ""}. No compartas este link.</p> : null}
      </div>

      <EventPicker slug={slug} range={range} variant="bar" />

      <FilterBar categories={categories} category={category} onCategory={(value) => { setCategory(value); setShown(PAGE_SIZE); }} sort={sort} onSort={setSort} query={query} onQuery={(value) => { setQuery(value); setShown(PAGE_SIZE); }} showPrices={showPrices} activeFilters={activeFilterCount(filters)} onOpenFilters={() => setFiltersOpen(true)} />
      <div className="cp-catalog-layout">
        {items.length > 0 ? (
          <aside className="cp-filters" aria-label="Filtros del catálogo">
            <div className="cp-filters-head">
              <h3 className="cp-fgroup-title">Filtros</h3>
              {activeFilterCount(filters) > 0 ? <button type="button" className="cp-link cp-linkbtn" onClick={() => changeFilters(EMPTY_FILTERS)}>Limpiar</button> : null}
            </div>
            <FiltersPanel {...filterProps} />
          </aside>
        ) : null}
        <div className="cp-catalog-main">
        {items.length > 0 ? <p className="cp-results" role="status" data-testid="results-count">{ordered.length === 1 ? "Mostrando 1 producto" : `Mostrando ${ordered.length} productos`}</p> : null}
        {cartNotice ? (
          <p className="cp-note" role="status" data-testid="cart-notice">
            {cartNotice} <button type="button" className="cp-link cp-linkbtn" onClick={() => setCartNotice("")}>Entendido</button>
          </p>
        ) : null}

        {items.length === 0 ? <EmptyState icon="box" title="Todavía no hay productos publicados" text="Cuando la empresa publique su catálogo lo vas a ver acá." /> : null}
        {items.length > 0 && visible.length === 0 ? (
          <EmptyState icon="search" title="No encontramos productos con esos filtros" text="Probá con otra palabra o quitá los filtros." action={{ label: "Limpiar filtros", onClick: () => { setQuery(""); setCategory(null); setFilters(EMPTY_FILTERS); setShown(PAGE_SIZE); } }} />
        ) : null}
        {flat
          ? page.length > 0 ? <ul className="cp-grid" aria-label="Productos">{page.map(renderItem)}</ul> : null
          : pageGroups.map(([groupName, rows]) => (
              <section key={groupName} className="cp-group" aria-label={groupName}>
                <div className="cp-group-head">
                  <h3 className="cp-group-title">{groupName}</h3>
                  <span className="cp-group-count">{visible.filter((item) => item.category === groupName).length}</span>
                </div>
                <ul className="cp-grid">{rows.map(renderItem)}</ul>
              </section>
            ))}
        {ordered.length > shown ? (
          <div className="cp-loadmore">
            <button type="button" className="cp-btn" onClick={() => setShown((value) => value + PAGE_SIZE)}>Mostrar más productos</button>
            <span className="cp-hint">Viendo {shown} de {ordered.length}</span>
          </div>
        ) : null}

        </div>
      </div>

      {count > 0 ? <OrderBar count={count} text={barText} onOpen={() => { setDone(null); setOpen(true); }} /> : null}
      {!contactOpen && !open && !quickItem && !filtersOpen ? toast : null}
      {filtersOpen ? <FiltersDrawer props={filterProps} onClose={() => setFiltersOpen(false)} onClear={() => changeFilters(EMPTY_FILTERS)} /> : null}

      {contactOpen ? (
        <ThemePortal>
          <ContactPanel
            slug={slug}
            storeName={storeName ?? organizationName}
            getCart={currentState}
            onClose={() => {
              try { window.sessionStorage.setItem(`${visitorKey}:skip`, "1"); } catch { /* sin almacenamiento */ }
              setContactOpen(false);
            }}
            onSaved={(token) => {
              try { window.localStorage.setItem(visitorKey, token); } catch { console.error("tienda: no se pudo recordar el enlace del carrito en este navegador"); }
              setVisitorToken(token);
            }}
          />
        </ThemePortal>
      ) : null}

      {quickItem ? (
        <ThemePortal>
          <QuickView
            item={quickItem}
            items={items}
            showPrices={showPrices}
            priceOf={priceOf}
            productApi={preorderPath.replace(/\/preorder$/, "/product/")}
            fichaHref={fichaBase ? `${fichaBase}/p/${encodeURIComponent(quickItem.id)}` : null}
            inCart={selection[quickItem.id] ?? 0}
            step={quantityStep(priceMode, Boolean(quickItem.package?.length))}
            onAdd={(id, quantity) => { addFromQuick(id, quantity); showToast("Agregado al pedido"); }}
            onNavigate={navigateQuick}
            onClose={closeQuick}
          />
        </ThemePortal>
      ) : null}

      {open ? (
        <ThemePortal>
          <CartDrawer
            slug={slug}
            preorderPath={preorderPath}
            wholesale={wholesale}
            clientName={clientName}
            range={range}
            onRange={applyRange}
            lines={chosen.map((item) => ({ id: item.id, name: item.name, sku: item.sku, quantity: selection[item.id], imageUrl: item.imageUrl, pieces: item.package?.length ? piecesText(item.package) : null, step: quantityStep(priceMode, Boolean(item.package?.length)) }))}
            onQuantity={setQuantity}
            localSubtotal={localSubtotal}
            perDay={perDay}
            view={view}
            showPrices={showPrices}
            priceMode={priceMode}
            zones={zones}
            zoneChoice={zoneChoice}
            onZone={setZoneChoice}
            done={done}
            onDone={setDone}
            // El pedido ya se envió: el carrito (navegador y servidor) se vacía en el acto, aunque cierren con Esc.
            onSent={() => { setSelection({}); setZoneChoice(""); setView(null); seenTotal.current = null; setCartNotice(""); }}
            onClose={() => setOpen(false)}
            onFinish={() => { setOpen(false); setDone(null); }}
          />
        </ThemePortal>
      ) : null}
    </section>
  );
}
