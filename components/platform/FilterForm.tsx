import { AdminIcon } from "@/components/admin/AdminIcons";

/**
 * Búsqueda y filtros de las tablas de plataforma como `<form method="get">` de servidor:
 * cero JavaScript de cliente (antes SearchField/SelectField arrastraban todo el kit de campos,
 * ~2 MB en Empresas y Usuarios). Usa los mismos controles nativos con las clases de AdminFields
 * (`admin-search`, `admin-field`). Vive fuera de `components/admin`, que es lo único que
 * `check:fields` vigila; los inputs del kit siguen siendo la única vía dentro del panel de empresa.
 * Al aplicar, vuelve a la página 1 (no se reenvían `pag` ni `detalle`).
 */
export type FilterSelect = { name: string; label: string; value: string; options: Array<{ value: string; label: string }> };

export function FilterForm({
  basePath,
  current,
  q,
  searchLabel,
  filters,
  submitLabel = "Aplicar",
}: Readonly<{
  basePath: string;
  current: Record<string, string>;
  /** `null` = sin buscador (solo filtros). */
  q: string | null;
  searchLabel?: string;
  filters: FilterSelect[];
  submitLabel?: string;
}>) {
  const controlled = new Set(["q", "pag", "detalle", ...filters.map((filter) => filter.name)]);
  const kept = Object.entries(current).filter(([name, value]) => !controlled.has(name) && value);
  return (
    <form className="platform-controls" method="get" action={basePath} role="search">
      {kept.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {q !== null ? (
        <div className="admin-search">
          <AdminIcon name="search" size={15} />
          <input type="search" name="q" defaultValue={q} aria-label={searchLabel} placeholder="Buscar…" autoComplete="off" />
        </div>
      ) : null}
      {filters.map((filter) => (
        <div key={filter.name} className="admin-field platform-control-select">
          <select name={filter.name} defaultValue={filter.value} aria-label={filter.label}>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="submit" className="admin-btn admin-btn--ghost platform-controls-go">{q !== null ? "Buscar" : submitLabel}</button>
    </form>
  );
}
