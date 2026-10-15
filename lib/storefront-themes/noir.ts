import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Noir»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const NOIR_THEME: ThemeDef = {
  id: "noir",
  rubro: "Tecnología, LED y sonido",
  label: "Noir",
  description: "Casi negro, texto blanco, un solo acento cian y fotos con brillo.",
  forWho: "Para tecnología, LED y electrónica",
  scheme: "dark",
  colors: {
    bg: "#0A0B0D", surface: "#131519", photo: "#EDEFF2", sand: "#1B1E24", text: "#F4F5F7", muted: "#A4A9B4", border: "#2B2F37", borderSoft: "#22252B",
    primary: "#22D3EE", primary700: "#67E8F9", onPrimary: "#031A20", accent: "#22D3EE", accentText: "#22D3EE",
    ink: "#050608", onInk: "#F4F5F7", onInkMuted: "#A4A9B4",
    success: "#4ADE80", warning: "#FBBF24", danger: "#F87171", infoBg: "#0F2A33",
    onImage: "#FFFFFF", scrim: "rgba(5, 6, 8, 0.72)", announceBg: "#22D3EE", announceText: "#031A20",
  },
  fonts: { display: F.sora, body: F.inter, script: null },
  radius: { sm: "8px", md: "12px", lg: "18px", pill: "999px" },
  shadow: { card: "0 0 0 1px rgba(255, 255, 255, 0.04)", float: "0 24px 60px rgba(0, 0, 0, 0.6)" },
  space: { sectionD: "96px", sectionM: "56px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "600" },
  layout: { category: "overlay", grid: "airy", hero: "photo", button: "soft", photoFit: "contain" },
  swatch: ["#0A0B0D", "#131519", "#22D3EE"],
};
