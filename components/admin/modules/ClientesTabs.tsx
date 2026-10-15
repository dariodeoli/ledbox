"use client";
import { AdminTabs } from "../AdminUI";

/** Directorio y mensajes comparten la misma sección de Clientes. */
export function ClientesTabs({ active, onNavigate }: { active: "directorio" | "mensajes"; onNavigate?: (href: string) => void }) {
  function onLinkClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest?.("a");
    const href = link?.getAttribute("href");
    if (!href?.startsWith("/") || href.startsWith("//") || link?.hasAttribute("download") || (link?.getAttribute("target") && link.getAttribute("target") !== "_self")) return;
    event.preventDefault();
    onNavigate(href);
  }
  return <div onClickCapture={onLinkClick}><AdminTabs label="Secciones de Clientes" compact items={[
    { href: "/clientes", label: "Directorio", icon: "clients", active: active === "directorio" },
    { href: "/clientes/mensajes", label: "Mensajes", icon: "mail", active: active === "mensajes" },
  ]} /></div>;
}
