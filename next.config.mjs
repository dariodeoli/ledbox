import { execFileSync } from "node:child_process";

// Se sella durante el build: el standalone no necesita conservar .git y la
// sonda de publicación compara el artefacto servido, no el checkout local.
function buildSha() {
  const supplied = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA || process.env.LEDBOX_BUILD_SHA;
  if (supplied && /^[a-f0-9]{40}$/i.test(supplied)) return supplied.toLowerCase();
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: { LEDBOX_BUILD_SHA: buildSha() },
  // Los utils ya entran por /utils; los componentes deben compartir React con
  // Next (externalizarlos rompe hooks durante SSR, Refs #173).
  transpilePackages: ["owncoding-ui"],
  serverExternalPackages: ["pdf-lib"],
  outputFileTracingIncludes: { "/api/*": ["./node_modules/pdf-lib/cjs/**/*", "./node_modules/pdf-lib/package.json", "./node_modules/@pdf-lib/**/*", "./node_modules/pako/**/*", "./node_modules/tslib/**/*"] },
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
