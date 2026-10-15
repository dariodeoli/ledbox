/** Esqueletos de carga de la tienda (mientras el servidor arma la portada, la ficha o la vista rápida). Decorativos. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="cp-grid" aria-hidden="true" data-testid="grid-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="cp-skel-card">
          <div className="cp-skel cp-skel-media" />
          <div className="cp-skel cp-skel-line cp-skel-line--sm" />
          <div className="cp-skel cp-skel-line" />
          <div className="cp-skel cp-skel-line cp-skel-line--sm" />
        </li>
      ))}
    </ul>
  );
}

export function QuickViewSkeleton() {
  return (
    <div className="cp-qv-info" aria-hidden="true" data-testid="quick-skeleton">
      <div className="cp-skel cp-skel-line cp-skel-line--sm" />
      <div className="cp-skel cp-skel-line cp-skel-line--lg" />
      <div className="cp-skel cp-skel-line" />
      <div className="cp-skel cp-skel-line" />
    </div>
  );
}
