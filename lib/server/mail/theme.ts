/** Pairs are explicit so native dark-mode clients override inline light styles
 * without leaving pale text on a pale surface. Outlook VML keeps the light CTA. */
export const MAIL_PALETTES = {
  light: {
    canvas: "#f3efe9", card: "#fffdfa", cardMuted: "#f8f5f0",
    graphite: "#20282b", ink: "#1f292c", muted: "#536168", mutedSoft: "#536168",
    line: "#c9c2b8", accent: "#08b7cf", accentSoft: "#e6f8fb", accentInk: "#063943",
    success: "#126344", successSoft: "#e8f6ef", warning: "#79500c", warningSoft: "#fff4dc",
    headerInk: "#ffffff", headerMuted: "#c6d2d5",
  },
  dark: {
    canvas: "#101619", card: "#1a2429", cardMuted: "#223039",
    graphite: "#10191e", ink: "#f1f5f6", muted: "#c6d2d5", mutedSoft: "#c6d2d5",
    line: "#52646e", accent: "#29d1e7", accentSoft: "#163b45", accentInk: "#b3f2fa",
    success: "#b7edcf", successSoft: "#183e2e", warning: "#ffe0a0", warningSoft: "#493414",
    headerInk: "#ffffff", headerMuted: "#c6d2d5",
  },
} as const;

function darkRules(prefix: string) {
  const p = MAIL_PALETTES.dark;
  const rule = (selector: string, declarations: string) => `${selector.split(",").map(s => `${prefix}${s}`).join(",")}{${declarations}}`;
  return [
    rule(".lb-canvas", `background-color:${p.canvas}!important;color:${p.ink}!important;`),
    rule(".lb-card,.lb-content", `background-color:${p.card}!important;color:${p.ink}!important;border-color:${p.line}!important;`),
    rule(".lb-summary,.lb-footer", `background-color:${p.cardMuted}!important;color:${p.ink}!important;border-color:${p.line}!important;`),
    rule(".lb-header", `background-color:${p.graphite}!important;color:${p.headerInk}!important;`),
    rule(".lb-header-ink", `color:${p.headerInk}!important;`),
    rule(".lb-header-muted", `color:${p.headerMuted}!important;`),
    rule(".lb-brand-dot", `color:${p.accent}!important;`),
    rule(".lb-ink", `color:${p.ink}!important;border-color:${p.line}!important;`),
    rule(".lb-muted", `color:${p.muted}!important;border-color:${p.line}!important;`),
    rule(".lb-soft", `color:${p.mutedSoft}!important;`),
    rule(".lb-link", `color:${p.accentInk}!important;`),
    rule(".lb-note", `background-color:${p.accentSoft}!important;color:${p.muted}!important;border-color:${p.accent}!important;`),
    rule(".lb-status-accent", `background-color:${p.accentSoft}!important;color:${p.accentInk}!important;`),
    rule(".lb-status-success", `background-color:${p.successSoft}!important;color:${p.success}!important;`),
    rule(".lb-status-warning", `background-color:${p.warningSoft}!important;color:${p.warning}!important;`),
    rule(".lb-status-neutral", `background-color:${p.cardMuted}!important;color:${p.muted}!important;`),
    // The bright CTA always uses dark ink, not the pale dark-mode link color.
    rule(".lb-cta-surface,.lb-btn", `background-color:${p.accent}!important;color:${MAIL_PALETTES.light.accentInk}!important;`),
  ].join("");
}

export const MAIL_THEME_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark;}@media(prefers-color-scheme:dark){${darkRules("")}}${darkRules("[data-ogsc] ")}`;
