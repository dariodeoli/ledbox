import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Boutique»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const BOUTIQUE_THEME: ThemeDef = {
  id: "boutique",
  rubro: "Bodas",
  label: "Boutique",
  description: "Crema, serif elegante, verde oliva y dorado. Radios suaves. Como una revista de decoración.",
  forWho: "Para bodas, vajilla y decoración",
  scheme: "light",
  colors: {
    bg: "#F6F2EA", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#EDE6D8", text: "#22241E", muted: "#5F5E54", border: "#DCD3C2", borderSoft: "#E6DECF",
    primary: "#4B5637", primary700: "#3A4329", onPrimary: "#FFFFFF", accent: "#9C7B45", accentText: "#76592A",
    ink: "#22241E", onInk: "#F6F2EA", onInkMuted: "#D6D0C2",
    success: "#3F6B45", warning: "#8A5300", danger: "#A3231C", infoBg: "#EEF0E6",
    onImage: "#FFFFFF", scrim: "rgba(34, 36, 30, 0.6)", announceBg: "#3A4329", announceText: "#F6F2EA",
  },
  fonts: { display: F.cormorant, body: F.jost, script: F.pinyon },
  radius: { sm: "12px", md: "18px", lg: "28px", pill: "999px" },
  shadow: { card: "0 1px 0 rgba(34, 36, 30, 0.04)", float: "0 20px 50px rgba(0, 0, 0, 0.18)" },
  space: { sectionD: "112px", sectionM: "64px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "68px", heroM: "44px", h2D: "48px", h2M: "34px", nameD: "26px", nameM: "22px", titleD: "56px", titleM: "38px", price: "18px", priceLg: "32px", display: "500" },
  layout: { category: "overlay", grid: "airy", hero: "photo", button: "pill", photoFit: "contain" },
  swatch: ["#F6F2EA", "#FFFFFF", "#4B5637"],
};
