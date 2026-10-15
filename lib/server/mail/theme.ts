/** Paleta sobria (estilo producto moderno): superficies neutras y un único color, el del botón.
 * Los pares son explícitos para que los clientes en modo oscuro pisen los estilos en línea claros
 * sin dejar texto claro sobre fondo claro. El botón de Outlook (VML) conserva su par claro. */
export const MAIL_PALETTES = {
  light: {
    canvas: "#f6f7f9", card: "#ffffff", cardMuted: "#f9fafb",
    ink: "#111111", body: "#3c4149", muted: "#6b7078", mutedSoft: "#6b7078",
    line: "#e6e8eb", lineStrong: "#c9cdd3",
    button: "#111111", buttonInk: "#ffffff",
    headerInk: "#111111", headerMuted: "#6b7078",
  },
  dark: {
    canvas: "#0e0f11", card: "#17181b", cardMuted: "#1d1f23",
    ink: "#f3f4f6", body: "#c9ccd1", muted: "#a0a5ae", mutedSoft: "#a0a5ae",
    line: "#2e3035", lineStrong: "#4a4d54",
    button: "#f3f4f6", buttonInk: "#111111",
    headerInk: "#f3f4f6", headerMuted: "#a0a5ae",
  },
} as const;

function darkRules(prefix: string) {
  const p = MAIL_PALETTES.dark;
  const rule = (selector: string, declarations: string) => `${selector.split(",").map(s => `${prefix}${s}`).join(",")}{${declarations}}`;
  return [
    rule(".lb-canvas", `background-color:${p.canvas}!important;color:${p.ink}!important;`),
    rule(".lb-card,.lb-content,.lb-header,.lb-footer,.lb-summary", `background-color:${p.card}!important;color:${p.ink}!important;border-color:${p.line}!important;`),
    rule(".lb-header-ink", `color:${p.headerInk}!important;`),
    rule(".lb-ink", `color:${p.ink}!important;border-color:${p.line}!important;`),
    rule(".lb-body", `color:${p.body}!important;`),
    rule(".lb-muted", `color:${p.muted}!important;border-color:${p.line}!important;`),
    rule(".lb-soft", `color:${p.mutedSoft}!important;`),
    rule(".lb-link", `color:${p.ink}!important;`),
    rule(".lb-foot-link", `color:${p.muted}!important;`),
    rule(".lb-note", `background-color:${p.cardMuted}!important;color:${p.muted}!important;border-color:${p.line}!important;`),
    rule(".lb-status-accent,.lb-status-success,.lb-status-warning,.lb-status-neutral", `background-color:${p.card}!important;color:${p.muted}!important;border-color:${p.line}!important;`),
    // Botón sin marca: negro en claro, claro en oscuro (con marca conserva su propio par).
    rule(".lb-cta-surface,.lb-btn", `background-color:${p.button}!important;color:${p.buttonInk}!important;`),
  ].join("");
}

export const MAIL_THEME_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark;}@media(prefers-color-scheme:dark){${darkRules("")}}${darkRules("[data-ogsc] ")}`;
