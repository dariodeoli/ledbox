import { F } from "./fonts";
import type { ThemeDef } from "./types";

export const MINIMAL_PRO_THEME: ThemeDef = {
  id: "minimal-pro", rubro: "Minimal y contemporáneo", label: "Minimal Pro",
  description: "Mucho aire, portada plana, tarjetas limpias y jerarquía directa.", forWho: "Para catálogos que necesitan claridad y velocidad", scheme: "light",
  colors: {
    bg: "#F7F8FA", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#EDF1F5", text: "#17202A", muted: "#52606D", border: "#C8D1DA", borderSoft: "#DEE5EB",
    primary: "#125B73", primary700: "#0D4659", onPrimary: "#FFFFFF", accent: "#1B9AAA", accentText: "#0F6E82", ink: "#17202A", onInk: "#FFFFFF", onInkMuted: "#D6E0E7",
    success: "#176B45", warning: "#7A4B00", danger: "#A3231C", infoBg: "#E6F2F6", onImage: "#FFFFFF", scrim: "rgba(23, 32, 42, .65)", announceBg: "#125B73", announceText: "#FFFFFF",
  },
  fonts: { display: F.jakarta, body: F.inter, script: null }, radius: { sm: "6px", md: "10px", lg: "14px", pill: "999px" },
  shadow: { card: "0 1px 2px rgba(23, 32, 42, .06)", float: "0 18px 42px rgba(23, 32, 42, .14)" },
  space: { sectionD: "64px", sectionM: "40px", gutterD: "28px", gutterM: "16px" }, container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "52px", heroM: "34px", h2D: "32px", h2M: "24px", nameD: "18px", nameM: "16px", titleD: "44px", titleM: "30px", price: "18px", priceLg: "30px", display: "700" },
  layout: { category: "card", grid: "airy", hero: "band", button: "soft", photoFit: "contain" }, swatch: ["#F7F8FA", "#FFFFFF", "#125B73"],
};
