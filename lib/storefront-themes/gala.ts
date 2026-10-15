import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Gala»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const GALA_THEME: ThemeDef = {
  id: "gala",
  rubro: "Bodas",
  label: "Gala",
  description: "Negro profundo con detalles dorados, serif de display y fotos con velo. Elegante y nocturno.",
  forWho: "Para bodas de gala y eventos nocturnos",
  scheme: "dark",
  colors: {
    bg: "#0C0B0A", surface: "#171513", photo: "#F2EEE6", sand: "#211E1A", text: "#F5F0E6", muted: "#B3AB9C", border: "#3A352D", borderSoft: "#2A2621",
    primary: "#C9A24D", primary700: "#DDB965", onPrimary: "#14110B", accent: "#C9A24D", accentText: "#D8B563",
    ink: "#050403", onInk: "#F5F0E6", onInkMuted: "#B3AB9C",
    success: "#6FCF8A", warning: "#F0B94A", danger: "#F28B82", infoBg: "#1E1A12",
    onImage: "#FFFFFF", scrim: "rgba(5, 4, 3, 0.74)", announceBg: "#C9A24D", announceText: "#14110B",
  },
  fonts: { display: F.cormorant, body: F.jost, script: null },
  radius: { sm: "4px", md: "8px", lg: "12px", pill: "999px" },
  shadow: { card: "0 0 0 1px rgba(201, 162, 77, 0.12)", float: "0 24px 60px rgba(0, 0, 0, 0.6)" },
  space: { sectionD: "112px", sectionM: "64px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "44px", h2D: "48px", h2M: "32px", nameD: "24px", nameM: "20px", titleD: "56px", titleM: "36px", price: "20px", priceLg: "32px", display: "500" },
  layout: { category: "overlay", grid: "airy", hero: "photo", button: "soft", photoFit: "contain" },
  swatch: ["#0C0B0A", "#171513", "#C9A24D"],
};
