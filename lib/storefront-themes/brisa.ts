import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Brisa»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const BRISA_THEME: ThemeDef = {
  id: "brisa",
  rubro: "Playa y náutica",
  label: "Brisa",
  description: "Azul profundo y arena, luminosa y moderna. Aire de playa y de puerto.",
  forWho: "Para eventos de playa y náutica",
  scheme: "light",
  colors: {
    bg: "#FBF7EF", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#F0E6D2", text: "#0E2238", muted: "#465A6E", border: "#D9D0BC", borderSoft: "#E8E0CE",
    primary: "#0B3C6E", primary700: "#082C52", onPrimary: "#FFFFFF", accent: "#2A9DA6", accentText: "#0B6770",
    ink: "#0A2540", onInk: "#F8F3E8", onInkMuted: "#C5D2E0",
    success: "#2F6B3A", warning: "#8A5300", danger: "#A3231C", infoBg: "#E3EEF7",
    onImage: "#FFFFFF", scrim: "rgba(10, 37, 64, 0.6)", announceBg: "#0B3C6E", announceText: "#FBF7EF",
  },
  fonts: { display: F.jakarta, body: F.jakarta, script: null },
  radius: { sm: "10px", md: "16px", lg: "24px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(10, 37, 64, 0.08)", float: "0 20px 50px rgba(10, 37, 64, 0.2)" },
  space: { sectionD: "96px", sectionM: "56px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "4 / 3", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "40px", h2M: "28px", nameD: "24px", nameM: "20px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "600" },
  layout: { category: "overlay", grid: "airy", hero: "photo", button: "pill", photoFit: "contain" },
  swatch: ["#FBF7EF", "#FFFFFF", "#0B3C6E"],
};
