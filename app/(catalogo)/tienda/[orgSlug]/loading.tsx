import { StoreChrome } from "@/components/catalog-public/StoreChrome";
import { ProductGridSkeleton } from "@/components/catalog-public/StoreSkeletons";

/** Mientras el servidor arma la tienda: esqueleto de encabezado, portada y grilla, con los tokens del tema por defecto. */
export default function StoreLoading() {
  return (
    <StoreChrome appearance={null}>
      <div className="cp-hd" aria-hidden="true"><div className="cp-hd-inner"><div className="cp-skel cp-skel-line cp-skel-line--lg" /></div></div>
      <main className="cp-page" aria-busy="true" aria-label="Cargando la tienda">
        <div className="cp-hero" data-cover="no"><div className="cp-hero-inner"><div className="cp-hero-copy" aria-hidden="true"><div className="cp-skel cp-skel-line cp-skel-line--sm" /><div className="cp-skel cp-skel-title" /><div className="cp-skel cp-skel-line cp-skel-sub" /></div></div></div>
        <div className="cp-container cp-sections"><ProductGridSkeleton count={8} /></div>
      </main>
    </StoreChrome>
  );
}
