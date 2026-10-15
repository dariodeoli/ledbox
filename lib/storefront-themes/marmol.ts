import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Mármol»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const MARMOL_THEME: ThemeDef = {
  id: "marmol",
  rubro: "Lujo y decoración premium",
  label: "Mármol",
  description: "Blanco y gris piedra con mucho aire, bordes finos y una serif didona. Sobrio y de lujo.",
  forWho: "Para lujo y decoración premium",
  scheme: "light",
  colors: {
    bg: "#FAFAF8", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#EFEEEA", text: "#1C1C1A", muted: "#585855", border: "#D3D2CD", borderSoft: "#E6E5E1",
    primary: "#1F3A5F", primary700: "#142842", onPrimary: "#FFFFFF", accent: "#A8A398", accentText: "#5E5A50",
    ink: "#1C1C1A", onInk: "#FAFAF8", onInkMuted: "#D0CFCA",
    success: "#2F6B3A", warning: "#8A5300", danger: "#A3231C", infoBg: "#ECEEF1",
    onImage: "#FFFFFF", scrim: "rgba(28, 28, 26, 0.58)", announceBg: "#1F3A5F", announceText: "#FAFAF8",
  },
  fonts: { display: F.playfair, body: F.inter, script: null },
  radius: { sm: "2px", md: "4px", lg: "6px", pill: "999px" },
  shadow: { card: "0 0 0 rgba(0, 0, 0, 0)", float: "0 20px 50px rgba(28, 28, 26, 0.14)" },
  space: { sectionD: "128px", sectionM: "72px", gutterD: "40px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "4 / 3", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "40px", h2M: "28px", nameD: "24px", nameM: "20px", titleD: "48px", titleM: "32px", price: "18px", priceLg: "32px", display: "400" },
  layout: { category: "card", grid: "airy", hero: "band", button: "soft", photoFit: "contain" },
  swatch: ["#FAFAF8", "#FFFFFF", "#1F3A5F"],
};
