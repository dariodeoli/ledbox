import { PREORDER_COPY } from "@/lib/storefront-ui";
import { XIcon } from "./StoreIcons";

/** Resumen persistente del pedido: mismos importes y cantidades en escritorio y celular, sin interrumpir la compra. */
export function OrderBar({ count, productCount, text, names, confirmation, onOpen }: {
  count: number; productCount: number; text: string | null; names: string[];
  confirmation: { key: number; text: string } | null; onOpen: () => void;
}) {
  const summary = names.slice(0, 2).join(" · ") + (names.length > 2 ? ` · y ${names.length - 2} más` : "");
  return (
    <aside className="cp-bar" aria-label={PREORDER_COPY.title} data-testid="order-bar">
      <div className="cp-bar-text">
        <strong key={count} className="cp-bar-count">{productCount} {productCount === 1 ? "producto" : "productos"} · {count} {count === 1 ? "unidad" : "unidades"}</strong>
        {text ? <span key={text} className="cp-bar-amount" data-testid="order-amount">{text}</span> : null}
        {confirmation ? <span key={confirmation.key} className="cp-bar-confirmation" role="status" data-testid="order-confirmation"><XIcon name="check" size={16} /><span title={confirmation.text}>{confirmation.text}</span></span> : <span className="cp-bar-product-names" title={names.join(" · ")}>{summary}</span>}
      </div>
      <button type="button" data-store-cart-trigger className="cp-btn cp-btn--primary" onClick={onOpen}><XIcon name="cart" size={18} />{PREORDER_COPY.open}</button>
    </aside>
  );
}
