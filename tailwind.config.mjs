/**
 * Tailwind del piloto OwnCoding UI (22-09-2026).
 *
 * Alcance mínimo y deliberado: el panel NO usa Tailwind; lo único que compila
 * Tailwind es la ruta /piloto-ui (y su componente de cliente). El `content` no
 * incluye el resto del panel ni el sitio público, así que Tailwind no genera
 * utilidades para clases que no sean del piloto.
 *
 * - `presets: [preset]` trae los tokens de la librería (`ink-*`, `fore`, `mute`,
 *   `fono`, …) desde CSS vars `--c-*`, además de su propio `content`
 *   (`node_modules/owncoding-ui/dist/**`).
 * - `preflight: false`: el reset de Tailwind no se emite. Sin esto reescribiría
 *   el panel entero (márgenes, bordes, tipografías) en la ruta del piloto.
 */
import preset from "owncoding-ui/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    "./app/(admin)/(panel)/piloto-ui/**/*.{ts,tsx}",
    // El preset declara `content: ['./node_modules/owncoding-ui/dist/**/*.js']`
    // y su comentario dice que Tailwind lo combina con el de la app. Con
    // Tailwind 3.4 **no** es así: `content` del preset se descarta
    // (normalizeConfig arma `content.files` solo con el config de la app), así
    // que las clases de los componentes (h-3, w-3, inline-flex, gap-1.5…) no se
    // generaban y los iconos salían gigantes. Hay que repetir la ruta acá.
    "./node_modules/owncoding-ui/dist/**/*.js",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
