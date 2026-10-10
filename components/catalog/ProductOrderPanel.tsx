"use client";

import { useState } from "react";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { usePublicCart } from "@/components/cart/PublicCartProvider";
import { addCartProduct } from "@/lib/public-cart";
import { LeadCaptureDialog } from "@/components/leads/LeadCaptureDialog";
import { whatsappUrl } from "@/lib/public-config";
import type { Product } from "@/lib/catalog";

/**
 * Pedido de una ficha de producto (issue #38): el carrito y el WhatsApp de la
 * landing comparten el pedido desde el layout público, sin cambiar el API de leads.
 */
export function ProductOrderPanel({ product }: { product: Product }) {
  const { cart, setCart } = usePublicCart();
  const [leadOpen, setLeadOpen] = useState(false);

  const add = () => {
    setCart(current => addCartProduct(current, product));
    setLeadOpen(true);
  };

  return (
    <>
      <div className="prod-order">
        <button className="btn-led" type="button" onClick={add}>Agregar al pedido</button>
        <a
          className="btn-line"
          href={whatsappUrl(`Hola LedBox! Quiero consultar disponibilidad para ${product.name} (${product.code}).`)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Consultar por WhatsApp
        </a>
      </div>
      <CartDrawer items={cart} onChange={setCart} onQuote={() => setLeadOpen(true)} />
      <LeadCaptureDialog open={leadOpen} items={cart} onClose={() => setLeadOpen(false)} />
    </>
  );
}
