/** Native modal dialog supplies background inertness and keyboard focus scope. */
export function openPublicMenu(dialog: HTMLDialogElement, trigger: HTMLButtonElement | null, close: () => void) {
  const doc = dialog.ownerDocument;
  const desktop = doc.defaultView!.matchMedia("(min-width: 769px)");
  if (desktop.matches) { close(); return () => {}; }
  const bodyOverflow = doc.body.style.overflow;
  const rootOverflow = doc.documentElement.style.overflow;
  dialog.showModal();
  doc.body.style.overflow = "hidden";
  doc.documentElement.style.overflow = "hidden";
  const onResize = () => { if (desktop.matches) close(); };
  desktop.addEventListener("change", onResize);
  return () => {
    desktop.removeEventListener("change", onResize);
    if (dialog.open) dialog.close();
    doc.body.style.overflow = bodyOverflow;
    doc.documentElement.style.overflow = rootOverflow;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
}
