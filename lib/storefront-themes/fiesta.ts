import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Fiesta»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const FIESTA_THEME: ThemeDef = {
  id: "fiesta",
  rubro: "Eventos y fiestas",
  label: "Fiesta",
  description: "Turquesa y amarillo sobre fondo marfil. Alegre y elegante, con serif redondeada.",
  forWho: "Para eventos sociales, cumpleaños y celebraciones",
  scheme: "light",
  colors: {
    bg: "#FFFAEB", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#FBEFC9", text: "#1F2A2C", muted: "#556164", border: "#EBD99A", borderSoft: "#F2E6B8",
    primary: "#0A7580", primary700: "#075A63", onPrimary: "#FFFFFF", accent: "#F4B400", accentText: "#7A5500",
    ink: "#12383D", onInk: "#FFFAEB", onInkMuted: "#D5E6E7",
    success: "#2F7A45", warning: "#8A5300", danger: "#A3231C", infoBg: "#E2F3F3",
    onImage: "#FFFFFF", scrim: "rgba(18, 56, 61, 0.64)", announceBg: "#F4B400", announceText: "#1F2A2C",
  },
  fonts: { display: F.fraunces, body: F.jost, script: null },
  radius: { sm: "12px", md: "18px", lg: "28px", pill: "999px" },
  shadow: { card: "0 2px 0 rgba(18, 56, 61, 0.06)", float: "0 20px 50px rgba(18, 56, 61, 0.2)" },
  space: { sectionD: "96px", sectionM: "56px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "48px", h2M: "32px", nameD: "24px", nameM: "20px", titleD: "56px", titleM: "36px", price: "20px", priceLg: "32px", display: "600" },
  layout: { category: "card", grid: "airy", hero: "photo", button: "pill", photoFit: "contain" },
  swatch: ["#FFFAEB", "#F4B400", "#0A7580"],
};
