"use client";

import { BancoLogo } from "owncoding-ui/financial";

/**
 * Logo de banco del panel y del portal: el `BancoLogo` de
 * owncoding-ui (v0.68.3, `LogoFinanciero`) con tamaño óptico parejo y placa
 * clara sobre fondo oscuro. Es el único dibujo de marcas de bancos de la app: sin archivos propios ni monogramas inventados.
 *
 * Honestidad: `soloCatalogo` devuelve `null` si el nombre no está en el catálogo
 * de la librería (banco tipeado a mano); el llamador ya muestra el nombre en
 * texto, así que nunca se dibuja un logo que no existe.
 */
export function BankLogo({ bank, variant = "compacto", size = "h-7", className }: { bank: string | null | undefined; variant?: "compacto" | "horizontal"; size?: string; className?: string }) {
  const name = String(bank ?? "").trim();
  if (!name) return null;
  return <BancoLogo banco={name} variante={variant} alto={size} className={className} soloCatalogo decorativo />;
}
