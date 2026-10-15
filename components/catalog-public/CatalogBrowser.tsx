"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AVAILABILITY_HINT_LABEL,
  catalogLine,
  catalogTierHints,
  estimatedSubtotal,
  formatDayKey,
  type AvailabilityHint,
  type CatalogPrice,
} from "@/lib/catalog-public";
import { deliveryExtraApplies, deliveryFee, deliveryRateText } from "@/lib/delivery-zones";
import { legacyTier, packageSummary, type PackageSummary } from "@/lib/price-tiers";
import { PRICE_COMMENT_MAX, parsePriceAmount } from "@/lib/price-request";
import { parseVisitorContact, selfShareLinks } from "@/lib/store-contact";
import { readLocalStoreCart, sanitizeStoreCart, storeCartKey, writeLocalStoreCart, type StoreCartState } from "@/lib/store-cart";
import type { CartLineView, CartView } from "@/lib/server/store-cart";
import { CityField, EmailField, PhoneField, TextAreaField, TextField } from "@/components/admin/AdminFields";

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
  /** Plantilla de la tienda (`editorial` dibuja secciones grandes y tarjetas de catálogo impreso). */
  template?: string;
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
};

type Done =
  | { kind: "saved"; respondBy: string; trackingPath: string; whatsappUrl: string | null; priceRequested: boolean }
  | { kind: "simulated"; message: string };

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;
const respondFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const AVAILABILITY_TONE: Record<AvailabilityHint, string> = { AVAILABLE: "cp-chip--ok", LOW: "cp-chip--warn", CONSULT: "cp-chip--muted" };

function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts;
}

/** «por día», «por evento» o «total por 5 días» según cómo se cobra esa cantidad de días. */
function unitLabel(mode: "BASE" | "PER_DAY" | "TOTAL" | "EVENT" | undefined, days: number | null): string {
  if (mode === "EVENT") return "por evento";
  if (mode === "TOTAL") return days ? `total por ${days} ${days === 1 ? "día" : "días"}` : "total";
  return "por día";
}

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

/** Iconos de línea (SVG) de la ficha del producto. Decorativos: el dato siempre va escrito al lado. */
function XIcon({ name }: { name: "users" | "ruler" | "puzzle" | "tag" }) {
  const paths: Record<typeof name, string> = {
    users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 5.2a3 3 0 0 1 0 5.6",
    ruler: "M3 15.5 15.5 3 21 8.5 8.5 21zM7 12l2.5 2.5M10 9l2 2M13 6l2.5 2.5",
    puzzle: "M10 4a2 2 0 1 1 4 0v1h4v4h-1a2 2 0 1 0 0 4h1v4h-4v-1a2 2 0 1 0-4 0v1H6v-4H5a2 2 0 1 1 0-4h1V5h4z",
    tag: "M3 12V4h8l9 9-8 8zM7.5 8.5h.01",
  };
  return (
    <svg className="cp-x-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}

function Placeholder() {
  return (
    <svg className="cp-ph" viewBox="0 0 64 48" role="img" aria-label="Sin foto" focusable="false">
      <rect x="6" y="6" width="52" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M24 42h16M32 36v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** «Sector Living › Lounge» → sección grande «Sector Living» y subsección «Lounge». */
function splitCategory(name: string): { root: string; sub: string | null } {
  const [root, ...rest] = name.split("›").map((part) => part.trim());
  return { root: root || name, sub: rest.length ? rest.join(" › ") : null };
}

/** `COD #527` a partir del SKU (sin repetir «COD» si el SKU ya lo trae). */
const codeOf = (sku: string) => `COD #${sku.replace(/^cod\s*#?\s*/i, "")}`;

/** Medidas, capacidad y demás datos: una línea por renglón de la descripción que cargó la empresa. */
const specLines = (description: string | null | undefined) =>
  (description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8);

/** «2 × Sofá p/2 + 4 × Sillón + Mesa baja»: las piezas del juego, tal como las cargó la empresa. */
const piecesText = (parts: NonNullable<CatalogItemView["package"]>) => parts.map((part) => (part.quantity > 1 ? `${part.quantity} × ${part.name}` : part.name)).join(" + ");

type CartSnapshot = { items: Array<{ id: string; quantity: number }>; from: string | null; to: string | null; zone: string };

export function CatalogBrowser({ organizationName, showPrices, preorderPath, wholesale, clientName, demo, items, range, initialCategory, zones = [], template, slug, cartScope = "public", savedCart = false, cartPath: cartPathProp, fichaBase, storeName }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const editorial = template === "editorial";
  // Visitante identificado: su carrito vive en el servidor bajo su enlace mágico (el token se guarda solo en este navegador).
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const cartPath = cartPathProp ?? (visitorToken ? `/api/catalog/${encodeURIComponent(slug)}/carrito/${visitorToken}/cart` : preorderPath.replace(/\/preorder$/, "/cart"));
  const saved = savedCart || Boolean(visitorToken);
  const cartKey = storeCartKey(slug, cartScope === "visitor" ? "public" : cartScope);
  const visitorKey = `ledbox-store-visitor:${slug.trim().toLowerCase()}`;
  const [contactOpen, setContactOpen] = useState(false);
  const contactAsked = useRef(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(initialCategory && items.some((item) => item.category === initialCategory) ? initialCategory : null);
  const [from, setFrom] = useState(range?.fromKey ?? "");
  const [to, setTo] = useState(range?.toKey ?? "");
  const [selection, setSelection] = useState<Record<string, number>>({});
  // Flete: "" = no elegí, COORDINATE = «a coordinar», o el id de una zona (vive acá para guardarse con el carrito).
  const [zoneChoice, setZoneChoice] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<CartView | null>(null);
  const [cartNotice, setCartNotice] = useState("");
  const seenTotal = useRef<number | null>(null);
  const today = useMemo(todayKey, []);

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
        if (state.to >= todayKey()) {
          setFrom(state.from);
          setTo(state.to);
          const extra = initialCategory ? `&categoria=${encodeURIComponent(initialCategory)}` : "";
          router.replace(`${pathname}?desde=${encodeURIComponent(state.from)}&hasta=${encodeURIComponent(state.to)}${extra}#catalogo`, { scroll: false });
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
  const visible = useMemo(() => {
    const needle = norm(query.trim());
    return items.filter((item) => (!category || item.category === category) && (!needle || norm(`${item.name} ${item.sku ?? ""} ${item.category} ${item.description ?? ""}`).includes(needle)));
  }, [items, query, category]);
  const groups = useMemo(() => {
    const map = new Map<string, CatalogItemView[]>();
    for (const item of visible) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [visible]);
  // Editorial: secciones grandes por categoría raíz y, dentro, subsecciones (el orden es el que decide la empresa).
  const editorialGroups = useMemo(() => {
    const roots = new Map<string, Map<string | null, CatalogItemView[]>>();
    for (const [name, rows] of groups) {
      const { root, sub } = splitCategory(name);
      const subs = roots.get(root) ?? new Map<string | null, CatalogItemView[]>();
      subs.set(sub, [...(subs.get(sub) ?? []), ...rows]);
      roots.set(root, subs);
    }
    return [...roots.entries()].map(([root, subs]) => ({ root, subs: [...subs.entries()] }));
  }, [groups]);

  const days = range?.days ?? 1;
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
    if (!ready || contactAsked.current || count === 0 || saved || cartScope !== "public") return;
    contactAsked.current = true;
    try {
      if (window.sessionStorage.getItem(`${visitorKey}:skip`)) return;
    } catch {
      /* sin almacenamiento: se ofrece igual */
    }
    setContactOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, count, saved, cartScope]);

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
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        console.error("tienda: no se pudo revalidar el carrito; se muestran los precios del catálogo", error);
        setView(null);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
    // `chosen` y `selection` se resumen en `selectionKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectionKey, range?.fromKey, range?.toKey, zoneChoice, cartPath]);

  function applyDates(event: FormEvent) {
    event.preventDefault();
    if (!from || !to) return;
    const extra = category ? `&categoria=${encodeURIComponent(category)}` : "";
    router.replace(`${pathname}?desde=${encodeURIComponent(from)}&hasta=${encodeURIComponent(to)}${extra}#catalogo`, { scroll: false });
  }
  const setQuantity = useCallback((id: string, next: number) => {
    setSelection((current) => {
      const copy = { ...current };
      if (next <= 0) delete copy[id];
      else copy[id] = Math.min(99, next);
      return copy;
    });
  }, []);

  function renderItem(item: CatalogItemView) {
    const unit = unitFor(item);
    const quantity = selection[item.id] ?? 0;
    const unitText = unit > 0 ? unitLabel(pricingFor(item)?.mode, range ? days : null) : "";
    const pack = showPrices && unit > 0 && item.package ? packageOf(item, days) : null;
    const savings = pack && !pack.incomplete && pack.packageTotal > 0 && pack.savings > 0 ? pack : null;
    const specs = specLines(item.description);
    const pieces = item.package?.length ? piecesText(item.package) : null;
    // Anatomía fija (misma altura y posición en toda la fila): foto cuadrada, chips, nombre, detalle con espacio
    // reservado y pie anclado al fondo con precio, disponibilidad y botón. Si falta un dato se reserva el lugar.
    return (
      <li key={item.id} className="cp-item cp-x-item" data-testid="catalog-item">
        <div className="cp-photo">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name} loading="lazy" />
          ) : (
            <Placeholder />
          )}
          {savings ? <span className="cp-save" data-testid="catalog-saving">Ahorrás {money(savings.savings)}</span> : null}
        </div>
        <div className="cp-item-body">
          <div className="cp-x-chips">
            <span className="cp-x-chip cp-x-chip--cod">{item.sku ? codeOf(item.sku) : "Sin código"}</span>
            <span className="cp-x-chip">{item.package?.length ? "Juego" : item.category.split("›")[0].trim()}</span>
          </div>
          <h4 className="cp-item-name">{fichaBase ? <a className="cp-x-namelink" href={`${fichaBase}/p/${encodeURIComponent(item.id)}`}>{item.name}</a> : item.name}</h4>
          <div className="cp-x-diff">
            {item.capacity ? (
              <span className="cp-x-cap" data-testid="catalog-capacity"><XIcon name="users" />{item.capacity} {item.capacity === 1 ? "persona" : "personas"}</span>
            ) : null}
          </div>
          <ul className="cp-x-specs" data-testid={pieces ? "catalog-pieces" : undefined}>
            <li className="cp-x-spec">{item.dimensions ? (<><XIcon name="ruler" /><span><span className="cp-x-k">Medidas</span> {item.dimensions}</span></>) : null}</li>
            <li className="cp-x-spec">{pieces ? (<><XIcon name="puzzle" /><span><span className="cp-x-k">Incluye</span> {pieces}</span></>) : null}</li>
          </ul>
          <p className="cp-x-desc">{specs.length > 0 ? specs.join(" · ") : ""}</p>
          <div className="cp-x-foot">
            <div className="cp-x-pricebox">
              <XIcon name="tag" />
              {showPrices && unit > 0 ? (
                <span className="cp-x-pricetext">
                  <span className="cp-ed-tag">{money(unit)}</span>
                  <span className="cp-ed-unit">{unitText}</span>
                </span>
              ) : (
                <span className="cp-ed-unit">Consultar precio</span>
              )}
            </div>
            <p className="cp-x-sub">
              {savings ? <span data-testid="catalog-package">Por separado <s>{money(savings.unitSum)}</s></span> : null}
              {!savings && showPrices ? catalogTierHints(item.price)[0] ?? "" : null}
            </p>
            <p className="cp-x-avail">
              {item.availability ? <span className={`cp-chip ${AVAILABILITY_TONE[item.availability]}`}>{AVAILABILITY_HINT_LABEL[item.availability]}</span> : null}
            </p>
            <div className="cp-x-actions">
              {quantity > 0 ? (
                <div className="cp-qty" role="group" aria-label={`Cantidad de ${item.name}`}>
                  <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity(item.id, quantity - 1)} aria-label={`Quitar una unidad de ${item.name}`}>−</button>
                  <output aria-live="polite">{quantity}</output>
                  <button type="button" className="cp-btn cp-btn--icon" onClick={() => setQuantity(item.id, quantity + 1)} aria-label={`Agregar una unidad de ${item.name}`}>+</button>
                </div>
              ) : (
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setQuantity(item.id, 1)} aria-label={`Agregar ${item.name} al pedido`}>Agregar al pedido</button>
              )}
              {fichaBase ? <a className="cp-btn" href={`${fichaBase}/p/${encodeURIComponent(item.id)}`} aria-label={`Ver la ficha de ${item.name}`}>Ver ficha</a> : null}
            </div>
          </div>
        </div>
      </li>
    );
  }

  return (
    <section id="catalogo" className="cp-section cp-catalog" aria-labelledby="catalogo-titulo">
      <div className="cp-section-head">
        <p className="cp-eyebrow">{wholesale ? "Catálogo mayorista" : "Catálogo de alquiler"}</p>
        <h2 id="catalogo-titulo" className="cp-h2 cp-h2--lg">Elegí tus equipos</h2>
        {wholesale ? <p className="cp-lead">Precios mayoristas, solo para vos{clientName ? ` (${clientName})` : ""}. No compartas este link.</p> : null}
      </div>

      <div className="cp-card cp-dates" aria-labelledby="fechas">
        <h3 id="fechas" className="cp-h3 cp-h3--plain">1. Fechas del alquiler</h3>
        <form className="cp-row" onSubmit={applyDates}>
          <label className="cp-field">
            <span>Desde</span>
            <input type="date" value={from} min={today} onChange={(event) => { setFrom(event.target.value); if (to && event.target.value > to) setTo(event.target.value); }} required />
          </label>
          <label className="cp-field">
            <span>Hasta</span>
            <input type="date" value={to} min={from || today} onChange={(event) => setTo(event.target.value)} required />
          </label>
          <button className="cp-btn" type="submit">Ver disponibilidad</button>
        </form>
        <p className="cp-hint">
          {range
            ? `Período: ${formatDayKey(range.fromKey)} al ${formatDayKey(range.toKey)} (${range.days} ${range.days === 1 ? "día" : "días"}). La disponibilidad es indicativa: la confirmamos al cotizar.`
            : "Elegí las fechas para ver la disponibilidad indicativa de cada equipo."}
        </p>
      </div>

      <div className="cp-toolbar">
        <h3 className="cp-h3 cp-h3--plain">2. Equipos</h3>
        <label className="cp-field cp-field--search">
          <span className="cp-sr">Buscar equipos</span>
          <input type="search" placeholder="Buscar por nombre, SKU o categoría" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {categories.length > 1 ? (
        <div className="cp-cats" role="group" aria-label="Filtrar por categoría">
          <button type="button" className="cp-cat" aria-pressed={category === null} onClick={() => setCategory(null)}>Todas</button>
          {categories.map((name) => (
            <button key={name} type="button" className="cp-cat" aria-pressed={category === name} onClick={() => setCategory(category === name ? null : name)}>{name}</button>
          ))}
        </div>
      ) : null}
      {cartNotice ? (
        <p className="cp-note" role="status" data-testid="cart-notice">
          {cartNotice} <button type="button" className="cp-link cp-linkbtn" onClick={() => setCartNotice("")}>Entendido</button>
        </p>
      ) : null}

      {items.length === 0 ? <p className="cp-empty">Todavía no hay equipos publicados en este catálogo.</p> : null}
      {items.length > 0 && visible.length === 0 ? <p className="cp-empty">No encontramos equipos con esos filtros.</p> : null}
      {editorial
        ? editorialGroups.map(({ root, subs }) => (
            <section key={root} className="cp-group cp-ed-group" aria-label={root}>
              <header className="cp-ed-head"><h3 className="cp-ed-title">{root}</h3></header>
              {subs.map(([sub, rows]) => (
                <div key={sub ?? "_"} className="cp-ed-sub">
                  {sub ? <h4 className="cp-ed-subtitle">{sub}</h4> : null}
                  <ul className="cp-grid cp-ed-grid">{rows.map(renderItem)}</ul>
                </div>
              ))}
            </section>
          ))
        : groups.map(([groupName, rows]) => (
            <section key={groupName} className="cp-group" aria-label={groupName}>
              <h3 className="cp-h3">{groupName}</h3>
              <ul className="cp-grid">{rows.map(renderItem)}</ul>
            </section>
          ))}

      {count > 0 ? (
        <aside className="cp-bar" aria-label="Tu pedido">
          <span className="cp-bar-badge" aria-hidden="true">{count}</span>
          <p className="cp-bar-text">
            <strong>{count} {count === 1 ? "equipo" : "equipos"}</strong>
            {showPrices ? (
              <span>{view && view.total !== null && range ? `Total estimado ${money(view.total)}` : subtotal !== null ? `Subtotal estimado ${money(subtotal)}` : range ? "Subtotal a cotizar" : "Elegí fechas para estimar"}</span>
            ) : null}
          </p>
          <button type="button" className="cp-btn cp-btn--primary" onClick={() => { setDone(null); setOpen(true); }}>
            Ver pedido
          </button>
        </aside>
      ) : null}

      {contactOpen ? (
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
      ) : null}

      {open ? (
        <PreorderDialog
          preorderPath={preorderPath}
          organizationName={organizationName}
          wholesale={wholesale}
          clientName={clientName}
          range={range}
          lines={chosen.map((item) => ({ id: item.id, name: item.name, sku: item.sku, quantity: selection[item.id], imageUrl: item.imageUrl, pieces: item.package?.length ? piecesText(item.package) : null }))}
          onQuantity={setQuantity}
          localSubtotal={localSubtotal}
          view={view}
          showPrices={showPrices}
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
      ) : null}
    </section>
  );
}

function CartLineDetail({ line, days }: { line: CartLineView | undefined; days: number }) {
  if (!line) return null;
  if (line.unitPrice === null) return <span className="cp-hint">Precio a cotizar</span>;
  const fixed = line.mode === "TOTAL" || line.mode === "EVENT";
  return (
    <span className="cp-hint cp-cart-price">
      {fixed ? `${money(line.unitPrice)} ${line.mode === "EVENT" ? "por evento" : `total por ${days} ${days === 1 ? "día" : "días"}`}` : `${money(line.unitPrice)} × ${line.days} ${line.days === 1 ? "día" : "días"}`}
      {line.quantity > 1 ? ` × ${line.quantity}` : ""} = <strong>{line.subtotal !== null ? money(line.subtotal) : "a cotizar"}</strong>
      {line.tier ? <> · escalón {line.tier}</> : null}
      {line.availability === "CONSULT" ? <> · <span className="cp-chip cp-chip--muted">Consultar disponibilidad</span></> : null}
    </span>
  );
}

function PreorderDialog(props: {
  preorderPath: string;
  organizationName: string;
  wholesale: boolean;
  clientName: string | null;
  range: Props["range"];
  lines: Array<{ id: string; name: string; sku: string | null; quantity: number; imageUrl: string | null; pieces: string | null }>;
  onQuantity: (id: string, next: number) => void;
  localSubtotal: number | null;
  view: CartView | null;
  showPrices: boolean;
  zones: CatalogZoneView[];
  zoneChoice: string;
  onZone: (value: string) => void;
  done: Done | null;
  onDone: (done: Done) => void;
  onSent: () => void;
  onClose: () => void;
  onFinish: () => void;
}) {
  const { range, lines, localSubtotal, view, showPrices, done, zones, zoneChoice } = props;
  const zone = zones.find((entry) => entry.id === zoneChoice) ?? null;
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0);
  // Flete y total: los del servidor (revalidados); sin red, el cálculo local con la misma regla.
  const fee = view ? view.delivery.fee : showPrices && zone ? deliveryFee(zone, pieces) : null;
  const subtotal = view ? view.itemsSubtotal : localSubtotal;
  const total = subtotal !== null ? subtotal + (fee ?? 0) : null;
  const viewLines = new Map((view?.lines ?? []).map((line) => [line.id, line]));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [place, setPlace] = useState("");
  const [city, setCity] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [askPrice, setAskPrice] = useState(false);
  const [priceComment, setPriceComment] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
      if (event.key === "Tab" && dialog.current) {
        const nodes = [...dialog.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([tabindex='-1']),textarea,select")];
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === firstNode) { event.preventDefault(); lastNode.focus(); }
        else if (!event.shiftKey && document.activeElement === lastNode) { event.preventDefault(); firstNode.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!range) { setError("Elegí las fechas del alquiler antes de enviar el pedido."); return; }
    if (location.length < 2) { setError("Contanos dónde es el evento: ciudad o dirección."); return; }
    const amount = askPrice ? parsePriceAmount(priceAmount.trim()) : null;
    if (askPrice && priceComment.trim().length < 3) { setError("Contanos por qué pedís un mejor precio (al menos 3 caracteres)."); return; }
    if (amount === "invalid") { setError("El monto que querés pagar tiene que ser un número entero en guaraníes."); return; }
    setError("");
    const payload = {
      name, phone, email, location, notes,
      from: range.fromKey, to: range.toKey,
      items: lines.map((line) => ({ inventoryId: line.id, quantity: line.quantity })),
      ...(zone ? { deliveryZoneId: zone.id } : zoneChoice === "COORDINATE" ? { deliveryCoordinate: true } : {}),
      // El monto deseado es solo un pedido: la empresa lo acepta, lo contraoferta o lo rechaza; nunca se aplica solo.
      ...(askPrice ? { priceRequest: { comment: priceComment.trim(), desiredAmount: amount } } : {}),
      website: trap,
    };
    const serialized = JSON.stringify(payload);
    // La misma clave solo se reutiliza para reenviar EXACTAMENTE el mismo pedido.
    if (!attempt.current || attempt.current.payload !== serialized) attempt.current = { key: crypto.randomUUID(), payload: serialized };
    setBusy(true);
    try {
      const response = await fetch(props.preorderPath, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key },
        body: serialized,
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 429) { setError("Hiciste muchos intentos seguidos. Esperá unos minutos y volvé a probar."); return; }
      if (!response.ok) { setError(typeof data.error === "string" && data.error !== "Invalid request." ? data.error : "Revisá tus datos: algún campo no es válido."); return; }
      if (data.simulated === true) { props.onDone({ kind: "simulated", message: String(data.message ?? "Esto es una demo: no se guardó nada.") }); return; }
      const preorder = data.preorder as { respondBy: string; trackingPath: string; whatsappUrl: string | null };
      props.onDone({ kind: "saved", respondBy: preorder.respondBy, trackingPath: preorder.trackingPath, whatsappUrl: preorder.whatsappUrl, priceRequested: askPrice });
      props.onSent();
    } catch (failure) {
      console.error("tienda: no se pudo enviar el pedido", failure);
      setError("No pudimos enviar el pedido. Revisá tu conexión y reintentá: no se duplica.");
    } finally {
      setBusy(false);
    }
  }

  // El lugar del evento: dirección o referencia + ciudad y departamento (el departamento se completa al elegir la ciudad).
  const location = [place.trim(), city.trim(), department.trim()].filter(Boolean).join(", ");
  const stepOneReady = Boolean(range) && lines.length > 0;
  const priceOk = !askPrice || priceComment.trim().length >= 3;
  const totalLabel = showPrices ? (total !== null ? money(total) : "A cotizar") : null;

  return (
    <div className="cp-overlay cp-overlay--drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className="cp-drawer" role="dialog" aria-modal="true" aria-labelledby="pedido-titulo" ref={dialog} tabIndex={-1}>
        {done ? (
          <>
            <header className="cp-drawer-head">
              <h2 id="pedido-titulo" className="cp-h2">{done.kind === "saved" ? "Recibimos tu pedido" : "Demo: no se guardó nada"}</h2>
              <button type="button" className="cp-btn cp-btn--icon" onClick={props.onFinish} aria-label="Cerrar">×</button>
            </header>
            <div className="cp-drawer-body cp-done" data-testid="preorder-done">
              {done.kind === "saved" ? (
                <>
                  <p>
                    Recibimos tu pedido. <strong>Todavía NO es una reserva confirmada</strong>: te respondemos antes de{" "}
                    <strong>{respondFormat.format(new Date(done.respondBy))}</strong>.
                  </p>
                  {done.priceRequested ? <p>Pediste un mejor precio: la empresa te responde en tu seguimiento. Nada cambia hasta que apruebes la versión final.</p> : null}
                  <p className="cp-hint">Podés seguirlo en cualquier momento con este link (guardalo):</p>
                  <p><a className="cp-link cp-wrap" href={done.trackingPath}>{done.trackingPath}</a></p>
                  {done.whatsappUrl ? (
                    <a className="cp-btn cp-btn--primary" href={done.whatsappUrl} target="_blank" rel="noopener noreferrer">
                      Enviar el resumen por WhatsApp
                    </a>
                  ) : null}
                </>
              ) : (
                <p>{done.message}</p>
              )}
            </div>
            <footer className="cp-drawer-foot"><button type="button" className="cp-btn" onClick={props.onFinish}>Cerrar</button></footer>
          </>
        ) : (
          <form onSubmit={step === 2 ? submit : (event) => { event.preventDefault(); if (stepOneReady && priceOk) { setError(""); setStep(2); } else if (!priceOk) setError("Contanos por qué pedís un mejor precio (al menos 3 caracteres)."); }} className="cp-drawer-form">
            <header className="cp-drawer-head">
              <div>
                <h2 id="pedido-titulo" className="cp-h2">{step === 1 ? (props.wholesale ? "Tu pedido mayorista" : "Tu pedido") : "Tus datos"}</h2>
                <p className="cp-hint" data-testid="cart-range">
                  {range ? <>Del {formatDayKey(range.fromKey)} al {formatDayKey(range.toKey)} · <strong>{range.days} {range.days === 1 ? "día" : "días"}</strong></> : "Sin fechas todavía"}
                  {props.wholesale && props.clientName ? ` · a nombre de ${props.clientName}` : ""}
                </p>
              </div>
              <button type="button" className="cp-btn cp-btn--icon" onClick={props.onClose} aria-label="Cerrar el pedido">×</button>
            </header>
            <div className="cp-drawer-body">
              {step === 1 ? (
                <>
                  {!range ? <p className="cp-error" role="alert">Elegí las fechas del alquiler antes de enviar el pedido.</p> : null}
                  <table className="cp-table" aria-label="Equipos del pedido">
                    <thead>
                      <tr>
                        <th scope="col">Producto</th>
                        {showPrices ? <th scope="col" className="cp-num">Unitario</th> : null}
                        {showPrices ? <th scope="col" className="cp-num">Total</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const priced = viewLines.get(line.id);
                        const fixed = priced?.mode === "TOTAL" || priced?.mode === "EVENT";
                        return (
                          <tr key={line.id} data-testid="cart-line">
                            <td className="cp-table-main">
                              <span className="cp-cart-thumb" aria-hidden="true">
                                {line.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={line.imageUrl} alt="" loading="lazy" />
                                ) : null}
                              </span>
                              <span className="cp-cart-info">
                                <strong className="cp-cart-name">{line.name}</strong>
                                {line.sku ? <span className="cp-hint">{codeOf(line.sku)}</span> : null}
                                <span className="cp-qty" role="group" aria-label={`Cantidad de ${line.name}`}>
                                  <button type="button" className="cp-btn cp-btn--icon" onClick={() => { if (line.quantity <= 1 && lines.length === 1) props.onClose(); props.onQuantity(line.id, line.quantity - 1); }} aria-label={`Quitar una unidad de ${line.name}`}>−</button>
                                  <output aria-live="polite">{line.quantity}</output>
                                  <button type="button" className="cp-btn cp-btn--icon" onClick={() => props.onQuantity(line.id, line.quantity + 1)} aria-label={`Agregar una unidad de ${line.name}`}>+</button>
                                </span>
                                {showPrices && range ? <span className="cp-hint">{priced?.mode === "EVENT" ? "Por evento" : `${range.days} ${range.days === 1 ? "día" : "días"}`}{priced?.availability === "CONSULT" ? " · consultar disponibilidad" : ""}</span> : null}
                                {showPrices && priced?.unitPrice ? <span className="cp-hint cp-unit-sm">{money(priced.unitPrice)} {priced.mode === "EVENT" ? "por evento" : fixed && range ? `total por ${range.days} ${range.days === 1 ? "día" : "días"}` : "por día"}</span> : null}
                                {priced?.tier ? <span className="cp-x-chip cp-tier-chip">Escalón {priced.tier}</span> : null}
                                {line.pieces ? <details className="cp-includes"><summary>Incluye</summary><p className="cp-hint">{line.pieces}</p></details> : null}
                              </span>
                            </td>
                            {showPrices ? (
                              <td className="cp-num" data-label="Unitario">
                                {priced?.unitPrice ? money(priced.unitPrice) : "A cotizar"}
                                {priced?.unitPrice ? <small className="cp-hint">{priced.mode === "EVENT" ? "por evento" : fixed && range ? `total por ${range.days} ${range.days === 1 ? "día" : "días"}` : "por día"}</small> : null}
                              </td>
                            ) : null}
                            {showPrices ? <td className="cp-num cp-num--strong" data-label="Total">{priced?.subtotal ? money(priced.subtotal) : "—"}</td> : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {zones.length > 0 ? (
                    <label className="cp-field">
                      <span>Flete (opcional)</span>
                      <select value={zoneChoice} onChange={(e) => props.onZone(e.target.value)} aria-describedby="flete-ayuda">
                        <option value="">Lo defino después</option>
                        {zones.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{showPrices && entry.basePrice > 0 ? ` · ${money(entry.basePrice)}` : ""}</option>)}
                        <option value="COORDINATE">A coordinar</option>
                      </select>
                      <small id="flete-ayuda" className="cp-hint">
                        {zone && showPrices
                          ? `Flete estimado ${money(fee ?? 0)}${deliveryExtraApplies(zone, pieces) ? ` (incluye recargo por más de ${zone.volumeThreshold} piezas)` : zone.volumeThreshold !== null && zone.extraPrice ? ` (${deliveryRateText(zone).split(" + ")[1]})` : ""}.`
                          : zoneChoice === "COORDINATE" ? "Coordinamos el flete con vos al responder." : "Si elegís la zona te mostramos el flete estimado."}
                      </small>
                    </label>
                  ) : null}
                  {showPrices ? (
                    <dl className="cp-summary" data-testid="cart-summary" aria-label="Resumen del pedido">
                      {view && view.tierSavings > 0 && subtotal !== null ? (
                        <>
                          <div><dt>Subtotal a precio de lista</dt><dd className="cp-num">{money(subtotal + view.tierSavings)}</dd></div>
                          <div><dt>Descuento por escalón de días</dt><dd className="cp-num cp-num--ok">− {money(view.tierSavings)}</dd></div>
                        </>
                      ) : null}
                      <div><dt>Subtotal de equipos</dt><dd className="cp-num">{subtotal !== null && range ? money(subtotal) : "A cotizar"}</dd></div>
                      {zoneChoice ? (
                        <div><dt>Flete{zone ? ` · ${zone.name}` : ""}</dt><dd className="cp-num">{zoneChoice === "COORDINATE" ? "A coordinar" : fee !== null ? money(fee) : "—"}</dd></div>
                      ) : null}
                      <div className="cp-summary-total"><dt>Total estimado</dt><dd className="cp-num">{total !== null && range ? money(total) : "A cotizar"}</dd></div>
                    </dl>
                  ) : null}
                  {showPrices ? <p className="cp-hint">Los precios no incluyen instalación ni cargos extra; la cotización los confirma. Los montos son los de hoy, calculados por el servidor.</p> : null}
                  {showPrices ? (
                    <div className="cp-price-ask" data-testid="price-ask">
                      <label className="cp-check">
                        <input type="checkbox" checked={askPrice} onChange={(e) => setAskPrice(e.target.checked)} aria-controls="mejor-precio" />
                        <span>Pedir un mejor precio</span>
                      </label>
                      {askPrice ? (
                        <div id="mejor-precio" className="cp-price-ask-fields">
                          <label className="cp-field"><span>¿Por qué lo pedís?</span><textarea value={priceComment} onChange={(e) => setPriceComment(e.target.value)} maxLength={PRICE_COMMENT_MAX} rows={2} required placeholder="Ej.: somos clientes frecuentes, es para un evento grande." /></label>
                          <label className="cp-field"><span>Monto que querías pagar en total, en Gs. (opcional)</span><input inputMode="numeric" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value.replace(/[^\d.\s]/g, "").slice(0, 16))} placeholder="Ej.: 1.200.000" /></label>
                          <p className="cp-hint">Es solo un pedido: la empresa te responde con su propuesta y el precio no cambia hasta que apruebes la versión final.</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="cp-hint">Para responderte necesitamos tus datos. No es una reserva: te confirmamos disponibilidad y precio.</p>
                  <div className="cp-fields cp-fields-grid" data-testid="cart-fields">
                    <TextField label="Nombre y apellido" required value={name} onChange={setName} minLength={2} maxLength={120} autoComplete="name" autoFocus />
                    <PhoneField label="WhatsApp" required value={phone} onChange={setPhone} />
                    <EmailField label="Correo" required value={email} onChange={setEmail} />
                    <CityField label="Ciudad" required value={city} onChange={setCity} onSelect={(selected, dept) => { setCity(selected); setDepartment(dept); }} />
                    <TextField label="Lugar del evento" required={!city.trim()} value={place} onChange={setPlace} maxLength={160} autoComplete="street-address" placeholder="Dirección, salón o referencia" hint={department ? `Departamento: ${department}` : undefined} />
                    <TextAreaField label="Comentarios" optional wide value={notes} onChange={setNotes} maxLength={1000} rows={3} />
                  </div>
                  <input className="cp-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
                  <p className="cp-legal">Al enviar aceptás que usemos estos datos solo para responder tu pedido.</p>
                </>
              )}
              {error ? <p className="cp-error" role="alert">{error}</p> : null}
            </div>
            <footer className="cp-drawer-foot">
              {showPrices ? (
                <p className="cp-drawer-total" data-testid="cart-total">
                  <strong>{total !== null ? `Total estimado: ${totalLabel}` : "Subtotal: a cotizar"}</strong>
                </p>
              ) : null}
              <div className="cp-row">
                {step === 2 ? <button type="button" className="cp-btn" onClick={() => setStep(1)}>Volver</button> : <button type="button" className="cp-btn" onClick={props.onClose}>Seguir eligiendo</button>}
                {step === 1 ? (
                  <button type="submit" className="cp-btn cp-btn--primary" disabled={!stepOneReady}>Continuar</button>
                ) : (
                  <button type="submit" className="cp-btn cp-btn--primary" disabled={busy || !range}>{busy ? "Enviando…" : "Enviar pedido"}</button>
                )}
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Panel lateral al agregar el primer producto: pide nombre y WhatsApp o correo (con uno alcanza) para guardar el carrito en
 * el servidor y retomarlo desde otro dispositivo con un enlace. También se puede «seguir sin datos» (carrito solo en este
 * navegador). El servidor valida, limita intentos y no revela si un contacto ya existe. El enlace se muestra una vez y la
 * persona se lo manda a sí misma (WhatsApp o correo desde su propio dispositivo): la tienda no envía nada por su cuenta.
 */
function ContactPanel({ slug, storeName, getCart, onClose, onSaved }: { slug: string; storeName: string; getCart: () => CartSnapshot; onClose: () => void; onSaved: (token: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; share: { whatsapp: string | null; mailto: string | null } } | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && panel.current) {
        const nodes = [...panel.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([tabindex='-1'])")];
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === firstNode) { event.preventDefault(); lastNode.focus(); }
        else if (!event.shiftKey && document.activeElement === lastNode) { event.preventDefault(); firstNode.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = parseVisitorContact({ name, phone, email });
    if (!checked.ok) { setError(checked.error); return; }
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(slug)}/cart/visitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, ...getCart(), website: trap }),
      });
      const data = (await response.json().catch(() => ({}))) as { token?: string; url?: string; share?: { whatsapp: string | null; mailto: string | null }; error?: string; simulated?: boolean; message?: string };
      if (response.status === 429) { setError("Hiciste muchos intentos seguidos. Esperá unos minutos o seguí sin datos."); return; }
      if (data.simulated) { setError(data.message ?? "Esto es una demo: no se guardó tu carrito."); return; }
      if (!response.ok || !data.token || !data.url) { setError(data.error ?? "No pudimos guardar tu carrito. Probá de nuevo o seguí sin datos."); return; }
      onSaved(data.token);
      setResult({ url: data.url, share: data.share ?? { whatsapp: null, mailto: null } });
    } catch (failure) {
      console.error("tienda: no se pudo crear el carrito guardado", failure);
      setError("No pudimos conectar. Revisá tu conexión o seguí sin datos.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
    } catch {
      setError("No pudimos copiar: seleccioná el enlace y copialo a mano.");
    }
  }

  return (
    <div className="cp-overlay cp-overlay--side" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-side" role="dialog" aria-modal="true" aria-labelledby="contacto-carrito" ref={panel}>
        {result ? (
          <div className="cp-done" data-testid="visitor-cart-done">
            <h2 id="contacto-carrito" className="cp-h2">Guardamos tu carrito</h2>
            <p>Con este enlace lo retomás desde cualquier dispositivo durante 30 días. Guardalo: no lo volvemos a mostrar.</p>
            <p><a className="cp-link cp-wrap" href={result.url}>{result.url}</a></p>
            <div className="cp-row">
              <button type="button" className="cp-btn" onClick={() => void copy()}>{copied ? "Enlace copiado" : "Copiar enlace"}</button>
              {result.share.whatsapp ? <a className="cp-btn" href={result.share.whatsapp} target="_blank" rel="noopener noreferrer">Enviármelo por WhatsApp</a> : null}
              {result.share.mailto ? <a className="cp-btn" href={result.share.mailto}>Enviármelo por correo</a> : null}
            </div>
            <p className="cp-hint">Estos botones abren tu propia app de mensajes: nosotros no enviamos nada por vos.</p>
            {error ? <p className="cp-error" role="alert">{error}</p> : null}
            <button type="button" className="cp-btn cp-btn--primary" onClick={onClose}>Seguir eligiendo</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="contacto-carrito" className="cp-h2">¿Guardamos tu carrito?</h2>
            <p className="cp-hint">Dejanos tu nombre y tu WhatsApp o tu correo (con uno alcanza) y retomá este carrito desde otro dispositivo con un enlace. Sin cuenta ni contraseña.</p>
            <div className="cp-fields">
              <TextField label="Nombre y apellido" required value={name} onChange={setName} minLength={2} maxLength={120} autoComplete="name" autoFocus />
              <PhoneField label="WhatsApp" value={phone} onChange={setPhone} />
              <EmailField label="Correo" value={email} onChange={setEmail} hint="Con el WhatsApp o el correo alcanza." />
            </div>
            <input className="cp-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
            <p className="cp-hint">Usamos tus datos solo para guardar tu carrito. Para enviar el pedido igual te los pedimos.</p>
            {error ? <p className="cp-error" role="alert">{error}</p> : null}
            <div className="cp-row">
              <button type="submit" className="cp-btn cp-btn--primary" disabled={busy}>{busy ? "Guardando…" : "Guardar mi carrito"}</button>
              <button type="button" className="cp-btn" onClick={onClose}>Seguir sin datos</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
