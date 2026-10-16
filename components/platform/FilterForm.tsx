import { Input as SharedInput, Select as SharedSelect } from "owncoding-ui";
import { AdminIcon } from "@/components/admin/AdminIcons";

/** GET form stays on the server. Library primitives preserve native names/defaultValue and
 * progressive submission without a second field kit or client-side filter state.
 * Applying filters returns to page 1 by omitting pag/detalle. */
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
          <SharedInput type="search" name="q" defaultValue={q} aria-label={searchLabel} placeholder="Buscar…" autoComplete="off" />
        </div>
      ) : null}
      {filters.map((filter) => (
        <div key={filter.name} className="admin-field platform-control-select">
          <SharedSelect name={filter.name} defaultValue={filter.value} aria-label={filter.label}>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SharedSelect>
        </div>
      ))}
      <button type="submit" className="admin-btn admin-btn--ghost platform-controls-go">{q !== null ? "Buscar" : submitLabel}</button>
    </form>
  );
}
