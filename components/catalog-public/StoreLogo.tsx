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
  // `dark` es el logo para fondos claros y `light` para fondos oscuros. Con las dos variantes se
  // muestra la que corresponde al esquema de la plantilla (las oscuras fijan el suyo) o, si la
  // plantilla no lo fija, al del sistema: todo por CSS. Con una sola variante se usa en ambos
  // temas sobre una chapa (oscura para la clara, clara para la oscura) para que se lea.
  const both = logos.light && logos.dark;
  const single = both ? "" : logos.light ? " cp-logo--plate" : " cp-logo--plate-light";
  return (
    <span className={`cp-logo${single}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={both ? "cp-logo-onlight" : undefined} src={logos.dark ? dark : light} alt={`Logo de ${name}`} />
      {both ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cp-logo-ondark" src={light} alt={`Logo de ${name}`} loading="lazy" />
      ) : null}
    </span>
  );
}
