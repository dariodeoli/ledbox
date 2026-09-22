"use client";

import { useState } from "react";
import { CartDrawer, type CartItem } from "@/components/cart/CartDrawer";
import { LeadCaptureDialog } from "@/components/leads/LeadCaptureDialog";
import { whatsappUrl } from "@/lib/public-config";
import type { Product } from "@/lib/catalog";

/**
 * Pedido de una ficha de producto (issue #38): el carrito y el WhatsApp de la
 * landing funcionan igual desde `/productos/<slug>`. El carrito sigue siendo
 * estado local de la página (como en la landing), así que no cambia ningún
 * contrato con el API de leads.
 */
export function ProductOrderPanel({ product }: { product: Product }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);

  const add = () => {
    setCart(current => {
      const existing = current.find(item => item.product.id === product.id);
      return existing
        ? current.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { product, quantity: 1, duration: 1 }];
    });
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
