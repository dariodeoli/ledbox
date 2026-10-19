import { F } from "./fonts";
import type { ThemeDef } from "./types";

export const EDITORIAL_PRO_THEME: ThemeDef = {
  id: "editorial-pro", rubro: "Editorial y premium", label: "Editorial Pro",
  description: "Portada fotográfica, serif editorial, tarjetas amplias y navegación tranquila.", forWho: "Para marcas que venden una experiencia", scheme: "light",
  colors: {
    bg: "#FBF8F2", surface: "#FFFFFF", photo: "#FFFFFF", sand: "#F1EBDD", text: "#27231F", muted: "#6A6259", border: "#D9CDBD", borderSoft: "#E9E0D4",
    primary: "#6F3C2F", primary700: "#542D24", onPrimary: "#FFFFFF", accent: "#B47A4E", accentText: "#805331", ink: "#27231F", onInk: "#FBF8F2", onInkMuted: "#DCCFC1",
    success: "#3E704B", warning: "#845700", danger: "#A3231C", infoBg: "#F4EDE2", onImage: "#FFFFFF", scrim: "rgba(39, 35, 31, .63)", announceBg: "#6F3C2F", announceText: "#FFFFFF",
  },
  fonts: { display: F.playfair, body: F.sourceSans, script: null }, radius: { sm: "4px", md: "8px", lg: "18px", pill: "999px" },
  shadow: { card: "0 1px 0 rgba(39, 35, 31, .08)", float: "0 22px 55px rgba(39, 35, 31, .18)" },
  space: { sectionD: "104px", sectionM: "60px", gutterD: "32px", gutterM: "16px" }, container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "48px", h2M: "32px", nameD: "24px", nameM: "20px", titleD: "56px", titleM: "36px", price: "18px", priceLg: "32px", display: "500" },
  layout: { category: "card", grid: "airy", hero: "photo", button: "pill", photoFit: "contain" }, swatch: ["#FBF8F2", "#FFFFFF", "#6F3C2F"],
};
