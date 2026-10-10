"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { PUBLIC_CART_KEY, restoreCart, serializeCart, type CartItem } from "@/lib/public-cart";

type CartChange = CartItem[] | ((current: CartItem[]) => CartItem[]);
const CartContext = createContext<{ cart: CartItem[]; setCart: (change: CartChange) => void } | null>(null);

export function PublicCartProvider({ children }: { children: ReactNode }) {
  const [cart, updateCart] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { updateCart(restoreCart(window.sessionStorage.getItem(PUBLIC_CART_KEY))); } catch { /* Sin storage, conserva el pedido durante navegación cliente. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { window.sessionStorage.setItem(PUBLIC_CART_KEY, serializeCart(cart)); } catch { /* Storage bloqueado o lleno: el pedido sigue disponible en memoria. */ }
  }, [cart, ready]);
  const setCart = useCallback((change: CartChange) => updateCart(change), []);
  return <CartContext.Provider value={{ cart, setCart }}>{children}</CartContext.Provider>;
}

export function usePublicCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("El pedido público requiere PublicCartProvider");
  return context;
}
