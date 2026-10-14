import Link from "next/link";
import { withParams, type RawParams } from "@/lib/platform/tablas";

/** Encabezado de columna ordenable: alterna ascendente/descendente por URL y vuelve a la página 1. */
export function SortHeader({
  basePath,
  params,
  sortKey,
  active,
  dir,
  children,
}: Readonly<{ basePath: string; params: RawParams; sortKey: string; active: string; dir: "asc" | "desc"; children: React.ReactNode }>) {
  const isActive = active === sortKey;
  const next = isActive && dir === "asc" ? `-${sortKey}` : sortKey;
  return (
    <th scope="col" aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link className="platform-sort" href={withParams(basePath, params, { orden: next, pag: undefined })}>
        {children}
        <span aria-hidden="true">{isActive ? (dir === "asc" ? " ▲" : " ▼") : ""}</span>
      </Link>
    </th>
  );
}
