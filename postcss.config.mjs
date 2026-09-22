/**
 * PostCSS del piloto (22-09-2026): habilita Tailwind 3.4 + autoprefixer.
 *
 * Ojo: al declarar este archivo, Next pasa **todo** el CSS de la app por
 * PostCSS. `app/globals.css` no tiene directivas `@tailwind`, así que Tailwind
 * lo deja pasar sin tocar; el único CSS con utilidades es
 * `app/(admin)/(panel)/piloto-ui/owncoding.css`.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
