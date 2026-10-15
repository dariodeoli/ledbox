import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Gourmet»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const GOURMET_THEME: ThemeDef = {
  id: "gourmet",
  rubro: "Catering y gastronomía",
  label: "Gourmet",
  description: "Vino y oliva sobre crema, con serif clásica. Mesa servida, sin estridencias.",
  forWho: "Para catering, banquetes y gastronomía",
  scheme: "light",
  colors: {
    bg: "#FAF6EE", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#EFE7D6", text: "#2A1B1D", muted: "#5E4C4E", border: "#DDD0BB", borderSoft: "#E8DECB",
    primary: "#7A1F22", primary700: "#5C1618", onPrimary: "#FFFFFF", accent: "#7A8A3C", accentText: "#566427",
    ink: "#2A1B1D", onInk: "#FAF6EE", onInkMuted: "#DCCFC2",
    success: "#3F6B45", warning: "#8A5300", danger: "#A3231C", infoBg: "#F1ECD8",
    onImage: "#FFFFFF", scrim: "rgba(42, 27, 29, 0.66)", announceBg: "#5C1618", announceText: "#FAF6EE",
  },
  fonts: { display: F.playfair, body: F.sourceSans, script: null },
  radius: { sm: "4px", md: "8px", lg: "14px", pill: "999px" },
  shadow: { card: "0 1px 0 rgba(42, 27, 29, 0.05)", float: "0 20px 50px rgba(42, 27, 29, 0.2)" },
  space: { sectionD: "104px", sectionM: "60px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "48px", h2M: "32px", nameD: "24px", nameM: "20px", titleD: "56px", titleM: "36px", price: "18px", priceLg: "32px", display: "500" },
  layout: { category: "overlay", grid: "airy", hero: "photo", button: "soft", photoFit: "contain" },
  swatch: ["#FAF6EE", "#7A8A3C", "#7A1F22"],
};
