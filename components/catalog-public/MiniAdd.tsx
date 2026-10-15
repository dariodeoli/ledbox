"use client";

import { useState } from "react";
import { XIcon } from "./StoreIcons";
import { addToStoredCart, type CartScope } from "./cart-add";
import { useStoreToast } from "./StoreToast";

/** Botón «+» de las tarjetas chicas de la ficha («Completá el ambiente», «Otros»): suma 1 al pedido y avisa con un toast. */
export function MiniAdd({ itemId, name, slug, scope, cartPath }: { itemId: string; name: string; slug: string; scope: CartScope; cartPath: string | null }) {
  const [busy, setBusy] = useState(false);
  const { toast, show } = useStoreToast();
  async function add() {
    setBusy(true);
    const result = await addToStoredCart({ slug, scope, cartPath, itemId, quantity: 1 });
    setBusy(false);
    show(result.ok ? `${name} agregado al pedido` : result.error);
  }
  return (
    <>
      <button type="button" className="cp-btn cp-btn--icon cp-mini-add" disabled={busy} onClick={() => void add()} aria-label={`Agregar ${name} al pedido`}><XIcon name="plus" size={18} /></button>
      {toast}
    </>
  );
}
