import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Escenario»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const ESCENARIO_THEME: ThemeDef = {
  id: "escenario",
  rubro: "Tecnología, LED y sonido",
  label: "Escenario",
  description: "Oscura, con un acento lima eléctrico. Letra ancha y mucho contraste, como una gira.",
  forWho: "Para producción de eventos, sonido e iluminación",
  scheme: "dark",
  colors: {
    bg: "#08090F", surface: "#12141D", photo: "#FFFFFF", sand: "#1A1D29", text: "#F5F6FA", muted: "#A9AEC2", border: "#2C3040", borderSoft: "#222636",
    primary: "#B6F23A", primary700: "#CDF86B", onPrimary: "#0B1104", accent: "#B6F23A", accentText: "#B6F23A",
    ink: "#050609", onInk: "#F5F6FA", onInkMuted: "#A9AEC2",
    success: "#4ADE80", warning: "#FBBF24", danger: "#F87171", infoBg: "#1B2410",
    onImage: "#FFFFFF", scrim: "rgba(5, 6, 9, 0.74)", announceBg: "#B6F23A", announceText: "#0B1104",
  },
  fonts: { display: F.archivo, body: F.inter, script: null },
  radius: { sm: "6px", md: "10px", lg: "16px", pill: "999px" },
  shadow: { card: "0 0 0 1px rgba(255, 255, 255, 0.05)", float: "0 24px 60px rgba(0, 0, 0, 0.65)" },
  space: { sectionD: "88px", sectionM: "52px", gutterD: "32px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "800" },
  layout: { category: "overlay", grid: "dense", hero: "photo", button: "soft", photoFit: "contain" },
  swatch: ["#08090F", "#12141D", "#B6F23A"],
};
