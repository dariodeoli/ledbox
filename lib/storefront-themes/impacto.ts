import { F } from "./fonts";
import type { ThemeDef } from "./types";

export const IMPACTO_THEME: ThemeDef = {
  id: "impacto", rubro: "Tecnología y activaciones", label: "Impacto",
  description: "Contraste alto, portada en banda, categorías superpuestas y catálogo compacto.", forWho: "Para activaciones, stands y equipos que deben destacar", scheme: "dark",
  colors: {
    bg: "#0B0D12", surface: "#151923", photo: "#FFFFFF", sand: "#1D2430", text: "#F7F9FC", muted: "#AEB7C8", border: "#344052", borderSoft: "#252E3D",
    primary: "#FFB000", primary700: "#FFC94D", onPrimary: "#17100A", accent: "#5AD9FF", accentText: "#7FE2FF", ink: "#050609", onInk: "#F7F9FC", onInkMuted: "#AEB7C8",
    success: "#52E39B", warning: "#FFCA5C", danger: "#FF7D92", infoBg: "#1D2A35", onImage: "#FFFFFF", scrim: "rgba(5, 6, 9, .78)", announceBg: "#FFB000", announceText: "#17100A",
  },
  fonts: { display: F.sora, body: F.inter, script: null }, radius: { sm: "4px", md: "8px", lg: "12px", pill: "999px" },
  shadow: { card: "0 0 0 1px rgba(255, 255, 255, .08)", float: "0 26px 65px rgba(0, 0, 0, .7)" },
  space: { sectionD: "72px", sectionM: "44px", gutterD: "28px", gutterM: "16px" }, container: "1280px",
  imageRatio: { card: "1 / 1", category: "1 / 1", hero: "21 / 9" },
  size: { heroD: "60px", heroM: "38px", h2D: "36px", h2M: "26px", nameD: "18px", nameM: "16px", titleD: "48px", titleM: "32px", price: "20px", priceLg: "34px", display: "700" },
  layout: { category: "overlay", grid: "dense", hero: "band", button: "soft", photoFit: "contain" }, swatch: ["#0B0D12", "#151923", "#FFB000"],
};
