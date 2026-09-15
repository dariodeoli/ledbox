"use client";
import Image from "next/image";
import type { Product } from "@/lib/catalog";

export function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  return <article className="prod rise">
    <span className="prod-tag">Alquiler</span>
    <div className="prod-art"><Image src={product.image} alt={product.alt} width={product.width} height={product.height} sizes="(max-width: 768px) calc(100vw - 40px), (max-width: 1024px) 45vw, 23vw" /></div>
    <div className="prod-num">{product.code}</div>
    <h3>{product.name}</h3>
    <p>{product.description}</p>
    <div className="prod-price">{product.unit === "sqm-day" ? "Gs. 480.000" : `Gs. ${product.price.toLocaleString("es-PY")}`} <small>{product.unitLabel}</small></div>
    <div className="prod-spec">{product.specs}</div>
    <button className="prod-add" type="button" onClick={() => onAdd(product)}>Agregar al pedido</button>
  </article>;
}
