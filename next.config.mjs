/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // owncoding-ui marca su entrada única con "use client": sin esto, los utils
  // puros (formatGs, issue #46) no se pueden llamar desde el servidor (mails,
  // timeline, imprimibles, API). Reportar upstream: partir componentes de utils.
  serverExternalPackages: ["owncoding-ui"],
  images: { formats: ["image/avif", "image/webp"], minimumCacheTTL: 60 * 60 * 24 * 30 },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // El service worker del panel (issue #23) se sirve siempre fresco para poder actualizarlo.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/offline.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/manifest-panel.webmanifest", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};
export default nextConfig;
