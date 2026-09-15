"use client";
import { products, type Product } from "@/lib/catalog";
import { ProductCard } from "./ProductCard";
export function ProductGrid({ onAdd }: { onAdd: (product: Product) => void }) {
  return <div className="prod-grid">{products.map(product => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div>;
}
