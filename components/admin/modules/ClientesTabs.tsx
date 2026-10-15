"use client";
import { AdminTabs } from "../AdminUI";

/** Directorio y mensajes comparten la misma sección de Clientes. */
export function ClientesTabs({ active }: { active: "directorio" | "mensajes" }) {
  return <AdminTabs label="Secciones de Clientes" compact items={[
    { href: "/clientes", label: "Directorio", icon: "clients", active: active === "directorio" },
    { href: "/clientes/mensajes", label: "Mensajes", icon: "mail", active: active === "mensajes" },
  ]} />;
}
