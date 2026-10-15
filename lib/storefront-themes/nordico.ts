import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Tema «Nórdico»: solo tokens y variantes de layout. Registrado en `index.ts`. */
export const NORDICO_THEME: ThemeDef = {
  id: "nordico",
  rubro: "Mobiliario, living y oficinas",
  label: "Nórdico",
  description: "Madera clara y gris suave, formas simples y radios medios. Sans geométrica, ordenado y práctico.",
  forWho: "Para mobiliario, living y oficinas",
  scheme: "light",
  colors: {
    bg: "#F4F2EE", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#E7E4DE", text: "#25282B", muted: "#585D62", border: "#D3D1CB", borderSoft: "#E3E1DB",
    primary: "#6A4628", primary700: "#523519", onPrimary: "#FFFFFF", accent: "#B88B5A", accentText: "#7A5230",
    ink: "#25282B", onInk: "#F4F2EE", onInkMuted: "#CFCDC7",
    success: "#2F6B3A", warning: "#8A5300", danger: "#A3231C", infoBg: "#ECE8E0",
    onImage: "#FFFFFF", scrim: "rgba(37, 40, 43, 0.6)", announceBg: "#523519", announceText: "#F4F2EE",
  },
  fonts: { display: F.jost, body: F.jost, script: null },
  radius: { sm: "8px", md: "12px", lg: "16px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(37, 40, 43, 0.08)", float: "0 16px 40px rgba(37, 40, 43, 0.16)" },
  space: { sectionD: "80px", sectionM: "52px", gutterD: "28px", gutterM: "16px" },
  container: "1280px",
  imageRatio: { card: "1 / 1", category: "4 / 3", hero: "21 / 9" },
  size: { heroD: "56px", heroM: "36px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "500" },
  layout: { category: "card", grid: "dense", hero: "band", button: "soft", photoFit: "contain" },
  swatch: ["#F4F2EE", "#FFFFFF", "#6A4628"],
};
