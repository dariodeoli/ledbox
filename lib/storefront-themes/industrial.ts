import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Industrial»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const INDUSTRIAL_THEME: ThemeDef = {
  id: "industrial",
  rubro: "Exteriores y estructuras",
  label: "Industrial",
  description: "Gris carbón con naranja de seguridad. Letra firme, bordes rectos y datos técnicos a la vista.",
  forWho: "Para carpas, estructuras, generadores y equipos",
  scheme: "dark",
  colors: {
    bg: "#191C1F", surface: "#23272B", photo: "#FFFFFF", sand: "#2C3136", text: "#F2F3F4", muted: "#B3B9BF", border: "#40474E", borderSoft: "#343A40",
    primary: "#FF7A1A", primary700: "#FF9447", onPrimary: "#140A02", accent: "#FF7A1A", accentText: "#FF8C3A",
    ink: "#101214", onInk: "#F2F3F4", onInkMuted: "#B3B9BF",
    success: "#4ADE80", warning: "#FBBF24", danger: "#F87171", infoBg: "#2E2418",
    onImage: "#FFFFFF", scrim: "rgba(16, 18, 20, 0.74)", announceBg: "#FF7A1A", announceText: "#140A02",
  },
  fonts: { display: F.archivo, body: F.inter, script: null },
  radius: { sm: "2px", md: "4px", lg: "6px", pill: "999px" },
  shadow: { card: "0 0 0 1px rgba(255, 255, 255, 0.03)", float: "0 20px 50px rgba(0, 0, 0, 0.55)" },
  space: { sectionD: "80px", sectionM: "48px", gutterD: "28px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "56px", heroM: "36px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "800" },
  layout: { category: "card", grid: "dense", hero: "photo", button: "soft", photoFit: "contain" },
  swatch: ["#191C1F", "#23272B", "#FF7A1A"],
};
