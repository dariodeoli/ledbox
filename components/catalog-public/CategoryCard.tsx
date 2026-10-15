import { categoryDatum } from "@/lib/storefront-ui";
import type { PriceMode } from "@/lib/appearance";
import { ProductPlaceholder } from "./StoreIcons";

/**
 * Tarjeta de categoría: toda la tarjeta es el enlace. Imagen con proporción fija, nombre y un dato corto en texto
 * pequeño («38 productos · Desde Gs. 2.500»), sin pastillas. En Boutique y Noir la imagen va a sangre con el texto encima
 * (variante `data-category="overlay"` del tema). Sin foto: icono y degradé suave del tema, nunca letras sueltas.
 */
export function CategoryCard({ name, href, imageUrl, count, minUnit, showPrices, priceMode }: {
  name: string;
  href: string;
  imageUrl: string | null;
  count: number;
  minUnit: number | null;
  showPrices: boolean;
  priceMode: PriceMode;
}) {
  return (
    <a className="cp-catcard" href={href} data-testid="category-card">
      <span className="cp-catcard-media">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" loading="lazy" />
        ) : (
          <ProductPlaceholder size={44} />
        )}
      </span>
      <span className="cp-catcard-body">
        <span className="cp-catcard-name">{name}</span>
        <span className="cp-catcard-datum">{categoryDatum({ count, minUnit }, showPrices, priceMode)}</span>
      </span>
    </a>
  );
}
