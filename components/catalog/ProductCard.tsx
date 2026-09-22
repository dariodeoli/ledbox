"use client";
import Image from "next/image";
import Link from "next/link";
import { productPath, type Product } from "@/lib/catalog";

export function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  const href = productPath(product);
  return <article className="prod rise">
    <span className="prod-tag">Alquiler</span>
    <Link className="prod-art" href={href} aria-label={`Ver la ficha de ${product.name}`}>
      <Image src={product.image} alt={product.alt} width={product.width} height={product.height} sizes="(max-width: 768px) calc(100vw - 40px), (max-width: 1024px) 45vw, 23vw" />
    </Link>
    <div className="prod-num">{product.code}</div>
    <h3><Link href={href}>{product.name}</Link></h3>
    <p>{product.description}</p>
    <div className="prod-price">{product.unit === "sqm-day" ? "Gs. 480.000" : `Gs. ${product.price.toLocaleString("es-PY")}`} <small>{product.unitLabel}</small></div>
    <div className="prod-spec">{product.specs}</div>
    <div className="prod-actions">
      <button className="prod-add" type="button" onClick={() => onAdd(product)}>Agregar al pedido</button>
      <Link className="prod-more" href={href}>Ver ficha <span aria-hidden="true">→</span></Link>
    </div>
  </article>;
}
