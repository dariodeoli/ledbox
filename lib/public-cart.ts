import { productBySlug, type Product } from "@/lib/catalog";

export type CartItem = { product: Product; quantity: number; duration: number };
export const PUBLIC_CART_KEY = "ledbox-public-cart:v1";

/** El pedido guarda únicamente referencias al catálogo y cantidades, nunca datos del lead. */
export function serializeCart(items: CartItem[]): string {
  return JSON.stringify(items.map(({ product, quantity, duration }) => ({ productId: product.id, quantity, duration })));
}

export function restoreCart(value: string | null): CartItem[] {
  try {
    const rows: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(rows)) return [];
    const ids = new Set<string>();
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const { productId, quantity, duration } = row;
      const product = typeof productId === "string" ? productBySlug(productId) : null;
      if (!product || ids.has(product.id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isInteger(duration) || duration < 1 || duration > 90) return [];
      ids.add(product.id);
      return [{ product, quantity, duration }];
    });
  } catch {
    return [];
  }
}

export function addCartProduct(items: CartItem[], product: Product): CartItem[] {
  return items.some((item) => item.product.id === product.id)
    ? items.map((item) => item.product.id === product.id ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item)
    : [...items, { product, quantity: 1, duration: 1 }];
}
