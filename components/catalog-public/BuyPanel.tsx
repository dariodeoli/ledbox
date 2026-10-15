"use client";

import { useEffect, useState } from "react";
import { AVAILABILITY_HINT_LABEL, preorderWhatsappUrl, type AvailabilityHint } from "@/lib/catalog-public";
import { MAX_QUANTITY, productWhatsappMessage, PREORDER_COPY } from "@/lib/storefront-ui";
import { EventPicker } from "./EventPicker";
import { Stepper } from "./Stepper";
import { XIcon } from "./StoreIcons";
import { addToStoredCart, type CartScope } from "./cart-add";
import { useStoreToast } from "./StoreToast";

/**
 * Compra en la ficha: fechas con disponibilidad en vivo (la pista indicativa del servidor para el período elegido), cantidad,
 * «Agregar al pedido» ancho (UN solo botón primario), «Consultar por WhatsApp» secundario con el mensaje prearmado (producto,
 * código y fechas) y la nota legal. Suma al MISMO carrito de la tienda y avisa con un toast.
 */
export function BuyPanel({ itemId, name, sku, slug, scope, cartPath, range, availability, step, storeName, whatsappPhone, showPrices, basePath }: {
  itemId: string;
  name: string;
  sku: string | null;
  slug: string;
  scope: CartScope;
  cartPath: string | null;
  range: { fromKey: string; toKey: string; days: number } | null;
  availability: AvailabilityHint | null;
  step: number;
  storeName: string;
  whatsappPhone: string | null;
  showPrices: boolean;
  basePath: string;
}) {
  const [quantity, setQuantity] = useState(step);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast, show } = useStoreToast();
  useEffect(() => setQuantity(step), [step]);

  async function add() {
    setError("");
    setBusy(true);
    const result = await addToStoredCart({ slug, scope, cartPath, itemId, quantity });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    show(`Agregado al pedido (${result.count})`, { label: PREORDER_COPY.open, onClick: () => { window.location.href = `${basePath}#catalogo`; } });
    if (result.warning) setError(result.warning);
  }

  const whatsapp = preorderWhatsappUrl(whatsappPhone, productWhatsappMessage(storeName, { name, sku }, range));
  return (
    <div className="cp-buy" data-testid="product-add">
      <EventPicker slug={slug} range={range} variant="panel" restore title="Fechas del alquiler" emptyNote="Elegí la fecha del evento para ver si está disponible." />
      {range ? (
        <p className="cp-avail" data-tone={availability ?? "CONSULT"} data-testid="product-availability">
          {availability === "AVAILABLE" ? "Disponible para tu fecha" : availability === "LOW" ? AVAILABILITY_HINT_LABEL.LOW : "Consultar disponibilidad"}
        </p>
      ) : null}
      <div className="cp-buy-row">
        <Stepper label={name} value={quantity} step={step} min={step} max={MAX_QUANTITY} onChange={setQuantity} />
        <button type="button" className="cp-btn cp-btn--primary cp-btn--lg" disabled={busy} onClick={() => void add()}><XIcon name="plus" size={18} />Agregar a la preorden</button>
      </div>
      {whatsapp ? <a className="cp-btn cp-btn--block" href={whatsapp} target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a> : null}
      <p className="cp-panel-note">{showPrices ? "Los precios son de referencia y se confirman en la cotización. " : ""}{PREORDER_COPY.notice} {PREORDER_COPY.logistics}</p>
      {error ? <p className="cp-note" role="status">{error}</p> : null}
      {toast}
    </div>
  );
}
