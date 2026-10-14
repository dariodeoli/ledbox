"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SearchField, SelectField } from "@/components/admin/AdminFields";

/**
 * Búsqueda y filtros de una tabla: cambian la URL (server-side) y vuelven a la página 1.
 * Recibe solo textos ya listos; no importa nada de servidor.
 */
export type TableFilter = { name: string; label: string; value: string; options: Array<{ value: string; label: string }> };

function buildUrl(basePath: string, current: Record<string, string>, changes: Record<string, string>): string {
  const query = new URLSearchParams();
  const merged = { ...current, ...changes };
  delete merged.pag;
  delete merged.detalle;
  for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

export function TableControls({
  basePath,
  current,
  q,
  filters,
  searchLabel,
}: Readonly<{ basePath: string; current: Record<string, string>; q: string; filters: TableFilter[]; searchLabel: string }>) {
  const router = useRouter();
  const [text, setText] = useState(q);
  return (
    <form
      className="platform-controls"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(buildUrl(basePath, current, { q: text.trim() }));
      }}
    >
      <SearchField value={text} onChange={setText} label={searchLabel} placeholder="Buscar…" />
      <button type="submit" className="admin-btn admin-btn--ghost platform-controls-go">Buscar</button>
      {filters.map((filter) => (
        <SelectField
          key={filter.name}
          ariaLabel={filter.label}
          value={filter.value}
          options={filter.options}
          onChange={(value) => router.push(buildUrl(basePath, current, { [filter.name]: value, q }))}
        />
      ))}
    </form>
  );
}
