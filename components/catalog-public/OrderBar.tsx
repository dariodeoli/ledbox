/**
 * Barra del pedido, SOLO en móvil y tablet (en escritorio el pedido vive en el badge del encabezado y en el aviso al
 * agregar): compacta, «N productos · Ver pedido», con el espacio reservado al final de la página (ver `.cp-footer`) para
 * no tapar contenido. Se apila sobre el botón de WhatsApp sin pisarlo.
 */
export function OrderBar({ count, text, onOpen }: { count: number; text: string | null; onOpen: () => void }) {
  return (
    <aside className="cp-bar" aria-label="Tu pedido" data-testid="order-bar">
      <p className="cp-bar-text">
        <strong>{count} {count === 1 ? "producto" : "productos"}</strong>
        {text ? <span>{text}</span> : null}
      </p>
      <button type="button" className="cp-btn cp-btn--primary" onClick={onOpen}>Ver pedido</button>
    </aside>
  );
}
