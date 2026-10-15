import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Corporativo»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const CORPORATIVO_THEME: ThemeDef = {
  id: "corporativo",
  rubro: "Corporativo",
  label: "Corporativo",
  description: "Azul petróleo, sobrio, con grilla clara y bordes finos. Serio y fácil de recorrer.",
  forWho: "Para eventos corporativos, congresos y empresas",
  scheme: "light",
  colors: {
    bg: "#F3F7F8", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#E4EDEF", text: "#10242B", muted: "#47606A", border: "#C5D5DA", borderSoft: "#D8E3E6",
    primary: "#0F5566", primary700: "#0A3F4C", onPrimary: "#FFFFFF", accent: "#2A8CA0", accentText: "#0F6478",
    ink: "#0C2A33", onInk: "#F3F7F8", onInkMuted: "#C4D6DB",
    success: "#1F7A45", warning: "#8A5300", danger: "#A3231C", infoBg: "#E3F0F3",
    onImage: "#FFFFFF", scrim: "rgba(12, 42, 51, 0.66)", announceBg: "#0A3F4C", announceText: "#F3F7F8",
  },
  fonts: { display: F.jakarta, body: F.sourceSans, script: null },
  radius: { sm: "4px", md: "6px", lg: "10px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(12, 42, 51, 0.06)", float: "0 16px 40px rgba(12, 42, 51, 0.16)" },
  space: { sectionD: "80px", sectionM: "48px", gutterD: "28px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "56px", heroM: "36px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "700" },
  layout: { category: "card", grid: "dense", hero: "band", button: "soft", photoFit: "contain" },
  swatch: ["#F3F7F8", "#FFFFFF", "#0F5566"],
};
