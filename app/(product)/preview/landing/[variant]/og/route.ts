import { ImageResponse } from "next/og";
import { createElement } from "react";
import { isProductLandingVariant, PRODUCT_LANDING_VARIANTS } from "@/lib/product-landing-previews";

export const runtime = "edge";

const palettes = {
  a: { background: "#08080f", foreground: "#ffffff", accent: "#00e5ff", secondary: "#20202b" },
  b: { background: "#101b20", foreground: "#f4f8f8", accent: "#00b9cd", secondary: "#24373c" },
  c: { background: "#f7f8f4", foreground: "#132023", accent: "#075c73", secondary: "#e5efec" },
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant: rawVariant } = await params;
  if (!isProductLandingVariant(rawVariant)) return new Response("Not found", { status: 404 });
  const content = PRODUCT_LANDING_VARIANTS[rawVariant];
  const palette = palettes[rawVariant];

  return new ImageResponse(
    createElement("div", { style: { display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: palette.background, color: palette.foreground, padding: "58px 68px", fontFamily: "Arial, sans-serif" } },
      createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, fontSize: 32, fontWeight: 700, letterSpacing: -1 } },
          createElement("span", { style: { display: "flex", width: 12, height: 42, background: palette.accent } }), "EventOS"),
        createElement("span", { style: { display: "flex", padding: "10px 16px", background: palette.secondary, color: palette.foreground, fontSize: 20, borderRadius: 3 } }, `Vista previa ${rawVariant.toUpperCase()}`)),
      createElement("div", { style: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 940 } },
        createElement("div", { style: { display: "flex", color: palette.accent, fontSize: 24, fontWeight: 700 } }, content.name),
        createElement("div", { style: { display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3 } }, content.headline)),
      createElement("div", { style: { display: "flex", justifyContent: "space-between", color: palette.foreground, fontSize: 21 } },
        createElement("span", null, "Presupuestos · eventos · operación"), createElement("span", null, "EventOS"))),
    { width: 1200, height: 630, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
