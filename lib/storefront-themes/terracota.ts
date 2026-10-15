import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Terracota»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const TERRACOTA_THEME: ThemeDef = {
  id: "terracota",
  rubro: "Catering y gastronomía",
  label: "Terracota",
  description: "Tierra, arcilla y crema: cálida y mediterránea, con serif y sans humanista.",
  forWho: "Para vajilla rústica y catering",
  scheme: "light",
  colors: {
    bg: "#FAF3E8", surface: "#FFFDF8", photo: "#FFFFFF", sand: "#F0E1CC", text: "#3A2418", muted: "#6B5446", border: "#E0CDB3", borderSoft: "#EBDCC5",
    primary: "#A64B2A", primary700: "#86391D", onPrimary: "#FFFFFF", accent: "#C8794A", accentText: "#8A3F1F",
    ink: "#3A2418", onInk: "#FAF3E8", onInkMuted: "#E3D0B8",
    success: "#3F6B45", warning: "#8A5300", danger: "#A3231C", infoBg: "#F6E7D3",
    onImage: "#FFFFFF", scrim: "rgba(58, 36, 24, 0.62)", announceBg: "#86391D", announceText: "#FAF3E8",
  },
  fonts: { display: F.fraunces, body: F.sourceSans, script: null },
  radius: { sm: "10px", md: "16px", lg: "24px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(58, 36, 24, 0.08)", float: "0 20px 50px rgba(58, 36, 24, 0.2)" },
  space: { sectionD: "96px", sectionM: "60px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "40px", h2M: "28px", nameD: "24px", nameM: "20px", titleD: "48px", titleM: "32px", price: "18px", priceLg: "32px", display: "500" },
  layout: { category: "card", grid: "airy", hero: "photo", button: "pill", photoFit: "contain" },
  swatch: ["#FAF3E8", "#FFFDF8", "#A64B2A"],
};
