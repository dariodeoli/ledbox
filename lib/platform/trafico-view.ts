import type { HostRow } from "@/lib/platform/queries/trafico";

/**
 * Lógica pura de la pantalla «Tráfico» (sin base ni DOM): reparte los hosts en los tres
 * sitios del negocio y la demo, y da formato a duraciones y porcentajes. La demo (`isDemo`)
 * nunca entra en un sitio ni en un total: va en su propia sección.
 */

export const SITE_KEYS = ["sitio", "eventos", "portal"] as const;
export type SiteKey = (typeof SITE_KEYS)[number];

export const SITE_LABELS: Record<SiteKey, string> = {
  sitio: "Sitio ledbox.online",
  eventos: "Landing EventOS",
  portal: "Portal de clientes",
};

export type SiteHosts = Record<SiteKey, string> & { demo: string };

export type SiteCardData = { key: SiteKey; label: string; host: string; row: HostRow | null };

/** Reparte las filas por host: cada sitio con su fila (o null si no hay datos) y la demo aparte. */
export function splitHosts(rows: HostRow[], hosts: SiteHosts): { sites: SiteCardData[]; demo: HostRow | null } {
  const business = rows.filter((row) => !row.isDemo && row.host !== hosts.demo);
  return {
    sites: SITE_KEYS.map((key) => ({
      key,
      label: SITE_LABELS[key],
      host: hosts[key],
      row: business.find((row) => row.host === hosts[key]) ?? null,
    })),
    demo: rows.find((row) => row.isDemo || row.host === hosts.demo) ?? null,
  };
}

/** Suma de vistas del negocio: nunca incluye la demo. */
export function businessViews(rows: HostRow[], demoHost: string): number {
  return rows.filter((row) => !row.isDemo && row.host !== demoHost).reduce((sum, row) => sum + row.views, 0);
}

export function parseSite(raw: string | string[] | undefined): SiteKey | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SITE_KEYS as readonly string[]).includes(value ?? "") ? (value as SiteKey) : null;
}

/** «1 min 05 s», «42 s» o «sin datos» si no hay medición. */
export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "sin datos";
  const total = Math.round(sec);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "sin datos";
  return `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(value)} %`;
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return "sin datos";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: digits }).format(value);
}
