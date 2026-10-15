import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Lienzo»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const LIENZO_THEME: ThemeDef = {
  id: "lienzo",
  rubro: "Versátil",
  label: "Lienzo",
  description: "Blanco cálido, letra geométrica, mucho aire, bordes finos y sin sombras. Fotos sobre fondo neutro.",
  forWho: "Para casi cualquier rubro",
  scheme: "light",
  colors: {
    bg: "#FAF8F4", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#F1EDE5", text: "#1D1C1A", muted: "#5B5851", border: "#E3DED4", borderSoft: "#ECE8DF",
    primary: "#26355D", primary700: "#1B2745", onPrimary: "#FFFFFF", accent: "#8C6B3E", accentText: "#7A5A2E",
    ink: "#1D1C1A", onInk: "#FAF8F4", onInkMuted: "#CFCBC2",
    success: "#2F6B3F", warning: "#8A5300", danger: "#A8281F", infoBg: "#EEF1F7",
    onImage: "#FFFFFF", scrim: "rgba(29, 28, 26, 0.62)", announceBg: "#1D1C1A", announceText: "#FAF8F4",
  },
  fonts: { display: F.outfit, body: F.outfit, script: null },
  radius: { sm: "6px", md: "10px", lg: "14px", pill: "999px" },
  shadow: { card: "none", float: "0 12px 32px rgba(29, 28, 26, 0.12)" },
  space: { sectionD: "96px", sectionM: "56px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "4 / 3", hero: "21 / 9" },
  size: { heroD: "56px", heroM: "36px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "500" },
  layout: { category: "card", grid: "airy", hero: "band", button: "soft", photoFit: "contain" },
  swatch: ["#FAF8F4", "#FFFFFF", "#26355D"],
};
