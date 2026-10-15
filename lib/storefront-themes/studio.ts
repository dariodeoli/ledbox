import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Studio»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const STUDIO_THEME: ThemeDef = {
  id: "studio",
  rubro: "Catálogos grandes",
  label: "Studio",
  description: "Moderno y comercial: grilla densa, letra gruesa, chips de filtro y etiquetas de oferta y stock.",
  forWho: "Para catálogos grandes",
  scheme: "light",
  colors: {
    bg: "#F3F4F6", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#E8EAEE", text: "#0F172A", muted: "#475569", border: "#CBD2DC", borderSoft: "#DCE1E8",
    primary: "#1D4ED8", primary700: "#1E40AF", onPrimary: "#FFFFFF", accent: "#C2410C", accentText: "#B03A0A",
    ink: "#0F172A", onInk: "#F3F4F6", onInkMuted: "#CBD5E1",
    success: "#15803D", warning: "#9A5B00", danger: "#B91C1C", infoBg: "#E6EEFF",
    onImage: "#FFFFFF", scrim: "rgba(15, 23, 42, 0.64)", announceBg: "#0F172A", announceText: "#F3F4F6",
  },
  fonts: { display: F.archivo, body: F.inter, script: null },
  radius: { sm: "6px", md: "8px", lg: "12px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(15, 23, 42, 0.08)", float: "0 16px 40px rgba(15, 23, 42, 0.18)" },
  space: { sectionD: "72px", sectionM: "48px", gutterD: "24px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "4 / 3", hero: "21 / 9" },
  size: { heroD: "56px", heroM: "36px", h2D: "32px", h2M: "24px", nameD: "16px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "700" },
  layout: { category: "card", grid: "dense", hero: "band", button: "soft", photoFit: "contain" },
  swatch: ["#F3F4F6", "#FFFFFF", "#1D4ED8"],
};
