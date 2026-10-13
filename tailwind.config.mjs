import preset, { owncodingContent } from "owncoding-ui/tailwind-preset";

export default {
  presets: [preset],
  // El panel marca el tema con `data-theme` en `.admin-root` (no con `html.dark`):
  // las variantes `dark:` de la librería (placa clara de los logos financieros,
  // por ejemplo) siguen ese atributo.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    ...owncodingContent,
    "./components/admin/AdminFields.tsx",
    "./components/admin/AdminUI.tsx",
  ],
  corePlugins: { preflight: false },
};
