import { mountOverlay } from "@/lib/overlay-lifecycle";
/** Native modal dialog supplies background inertness and keyboard focus scope. */
export function openPublicMenu(dialog: HTMLDialogElement, trigger: HTMLButtonElement | null, close: () => void) {
  const doc = dialog.ownerDocument;
  const desktop = doc.defaultView!.matchMedia("(min-width: 769px)");
  if (desktop.matches) { close(); return () => {}; }
  dialog.showModal();
  const release = mountOverlay(dialog, { opener: trigger });
  const onResize = () => { if (desktop.matches) close(); };
  desktop.addEventListener("change", onResize);
  return () => {
    desktop.removeEventListener("change", onResize);
    if (dialog.open) dialog.close();
    release();
  };
}
