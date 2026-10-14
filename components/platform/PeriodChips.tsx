import Link from "next/link";
import { PERIOD_KEYS, PERIOD_LABELS, periodHref, type PeriodKey } from "@/lib/platform/periods";

/** Chips de período como enlaces: conservan los demás parámetros de la URL. */
export function PeriodChips({
  basePath,
  params,
  active,
}: Readonly<{ basePath: string; params: Record<string, string | string[] | undefined>; active: PeriodKey }>) {
  return (
    <div className="platform-chips" role="navigation" aria-label="Período">
      {PERIOD_KEYS.map((key) => (
        <Link
          key={key}
          href={periodHref(basePath, params, key)}
          className="platform-chip"
          data-active={key === active ? "true" : undefined}
          aria-current={key === active ? "true" : undefined}
          scroll={false}
        >
          {PERIOD_LABELS[key]}
        </Link>
      ))}
    </div>
  );
}
