import preset, { owncodingContent } from "owncoding-ui/tailwind-preset";

export default {
  presets: [preset],
  content: [...owncodingContent, "./components/admin/AdminFields.tsx", "./components/admin/AdminUI.tsx"],
  corePlugins: { preflight: false },
};
