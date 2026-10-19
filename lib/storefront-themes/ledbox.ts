import { F } from "./fonts";
import type { ThemeDef } from "./types";

/** Plantilla LedBox: identidad visual del sitio público aplicada a una tienda con catálogo y carrito. */
export const LEDBOX_THEME: ThemeDef = {
  id: "ledbox", rubro: "Tecnología, LED y sonido", label: "LedBox",
  description: "Fondo de escenario, retícula sutil, cyan eléctrico y acentos lima.",
  forWho: "Para alquileres de tecnología y producción de eventos", scheme: "dark",
  colors: {
    bg: "#08090F", surface: "#111521", photo: "#FFFFFF", sand: "#171D2A", text: "#F5F7FB", muted: "#A9B2C4", border: "#2A3546", borderSoft: "#202A39",
    primary: "#59D9FF", primary700: "#91E8FF", onPrimary: "#031016", accent: "#B6F23A", accentText: "#6FE2FF",
    ink: "#050609", onInk: "#F5F7FB", onInkMuted: "#A9B2C4", success: "#52E39B", warning: "#FBC35F", danger: "#FF7D92", infoBg: "#142331",
    onImage: "#FFFFFF", scrim: "rgba(5, 6, 9, 0.74)", announceBg: "#59D9FF", announceText: "#031016",
  },
  fonts: { display: F.archivo, body: F.inter, script: null },
  radius: { sm: "8px", md: "14px", lg: "20px", pill: "999px" },
  shadow: { card: "0 0 0 1px rgba(255, 255, 255, 0.06)", float: "0 24px 60px rgba(0, 0, 0, 0.65)" },
  space: { sectionD: "88px", sectionM: "52px", gutterD: "32px", gutterM: "16px" }, container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "64px", heroM: "40px", h2D: "32px", h2M: "24px", nameD: "20px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "32px", display: "800" },
  layout: { category: "overlay", grid: "dense", hero: "photo", button: "soft", photoFit: "contain" }, swatch: ["#08090F", "#111521", "#59D9FF"],
};
