import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Boutique»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const BOUTIQUE_THEME: ThemeDef = {
  id: "boutique",
  rubro: "Bodas",
  label: "Boutique",
  description: "Minimalista: blanco, negro, tipografía moderna del sistema y pocos elementos.",
  forWho: "Para bodas, vajilla y decoración",
  scheme: "light",
  colors: {
    bg: "#FFFFFF", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#F5F5F7", text: "#1D1D1F", muted: "#5F5F64", border: "#D2D2D7", borderSoft: "#E8E8ED",
    primary: "#111111", primary700: "#000000", onPrimary: "#FFFFFF", accent: "#1D1D1F", accentText: "#424245",
    ink: "#F5F5F7", onInk: "#1D1D1F", onInkMuted: "#5F5F64",
    success: "#1C6C3C", warning: "#805500", danger: "#B42318", infoBg: "#F5F5F7",
    onImage: "#FFFFFF", scrim: "rgba(0, 0, 0, 0.6)", announceBg: "#111111", announceText: "#FFFFFF",
  },
  fonts: { display: F.system, body: F.system, script: null },
  radius: { sm: "8px", md: "12px", lg: "16px", pill: "999px" },
  shadow: { card: "none", float: "none" },
  space: { sectionD: "48px", sectionM: "32px", gutterD: "24px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "48px", heroM: "32px", h2D: "32px", h2M: "24px", nameD: "16px", nameM: "14px", titleD: "40px", titleM: "28px", price: "18px", priceLg: "32px", display: "600" },
  layout: { category: "card", grid: "dense", hero: "photo", button: "soft", photoFit: "contain" },
  swatch: ["#FFFFFF", "#F5F5F7", "#111111"],
};
