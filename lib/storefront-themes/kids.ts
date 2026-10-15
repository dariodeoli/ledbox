import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Kids»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const KIDS_THEME: ThemeDef = {
  id: "kids",
  rubro: "Infantil",
  label: "Kids",
  description: "Azul, amarillo y verde suaves, con radios grandes y letra redonda. Simpática y ordenada.",
  forWho: "Para fiestas infantiles, inflables y animación",
  scheme: "light",
  colors: {
    bg: "#FFFBEA", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#E3F0FF", text: "#1B2A41", muted: "#4A5B73", border: "#C9DDF5", borderSoft: "#DCE9F8",
    primary: "#2160D8", primary700: "#184BAE", onPrimary: "#FFFFFF", accent: "#FFC933", accentText: "#7A4F00",
    ink: "#1B2A41", onInk: "#FFFBEA", onInkMuted: "#CFDCEE",
    success: "#1F7A45", warning: "#8A5300", danger: "#A3231C", infoBg: "#DFF5E6",
    onImage: "#FFFFFF", scrim: "rgba(27, 42, 65, 0.64)", announceBg: "#FFC933", announceText: "#1B2A41",
  },
  fonts: { display: F.outfit, body: F.jost, script: null },
  radius: { sm: "16px", md: "24px", lg: "36px", pill: "999px" },
  shadow: { card: "0 3px 0 rgba(33, 96, 216, 0.1)", float: "0 20px 50px rgba(27, 42, 65, 0.2)" },
  space: { sectionD: "88px", sectionM: "52px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "48px", h2M: "32px", nameD: "24px", nameM: "20px", titleD: "56px", titleM: "36px", price: "20px", priceLg: "32px", display: "600" },
  layout: { category: "card", grid: "airy", hero: "band", button: "pill", photoFit: "contain" },
  swatch: ["#FFFBEA", "#FFC933", "#2160D8"],
};
