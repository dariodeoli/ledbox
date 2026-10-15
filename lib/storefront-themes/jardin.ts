import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Jardín»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const JARDIN_THEME: ThemeDef = {
  id: "jardin",
  rubro: "Exteriores y bodas al aire libre",
  label: "Jardín",
  description: "Verdes naturales sobre fondo papel, serif suave y radios amables. Fresco y orgánico.",
  forWho: "Para exteriores y bodas al aire libre",
  scheme: "light",
  colors: {
    bg: "#F5F1E6", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#E8EBDC", text: "#1F2A1C", muted: "#55604F", border: "#CFD5BF", borderSoft: "#E0E4D0",
    primary: "#2F5D3A", primary700: "#234A2D", onPrimary: "#FFFFFF", accent: "#8A9A4B", accentText: "#566525",
    ink: "#1F2A1C", onInk: "#F5F1E6", onInkMuted: "#CBD2BF",
    success: "#2F6B3A", warning: "#8A5300", danger: "#A3231C", infoBg: "#E8EFDD",
    onImage: "#FFFFFF", scrim: "rgba(31, 42, 28, 0.62)", announceBg: "#234A2D", announceText: "#F5F1E6",
  },
  fonts: { display: F.lora, body: F.inter, script: null },
  radius: { sm: "10px", md: "16px", lg: "24px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(31, 42, 28, 0.06)", float: "0 20px 50px rgba(31, 42, 28, 0.18)" },
  space: { sectionD: "104px", sectionM: "64px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "4 / 3", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "40px", h2M: "28px", nameD: "24px", nameM: "20px", titleD: "48px", titleM: "32px", price: "18px", priceLg: "32px", display: "500" },
  layout: { category: "overlay", grid: "airy", hero: "photo", button: "pill", photoFit: "contain" },
  swatch: ["#F5F1E6", "#FFFFFF", "#2F5D3A"],
};
