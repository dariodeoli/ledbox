/** Logo de la empresa en la tienda: variante clara u oscura según el tema; sin logo, monograma con las iniciales. */
export function storeInitials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("");
  return (letters || "·").toUpperCase();
}

export function StoreLogo({ name, slug, logos }: { name: string; slug: string; logos?: { light: boolean; dark: boolean } }) {
  if (!logos || (!logos.light && !logos.dark)) {
    return <span className="cp-mono" aria-hidden="true">{storeInitials(name)}</span>;
  }
  const light = `/api/catalog/${encodeURIComponent(slug)}/logo/light`;
  const dark = `/api/catalog/${encodeURIComponent(slug)}/logo/dark`;
  // `dark` es el logo para fondos claros y `light` para fondos oscuros. Con una sola
  // variante se usa en ambos temas; la clara va sobre una chapa oscura para que se lea.
  const onlyLight = logos.light && !logos.dark;
  return (
    <picture className={onlyLight ? "cp-logo cp-logo--plate" : "cp-logo"}>
      {logos.light && logos.dark ? <source media="(prefers-color-scheme: dark)" srcSet={light} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logos.dark ? dark : light} alt={`Logo de ${name}`} />
    </picture>
  );
}
