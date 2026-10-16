import { mountOverlay } from "@/lib/overlay-lifecycle";
/** Landing cart keeps its adapter, with the same lifecycle as panel and store. */
export function mountCartDialogFocus(panel: HTMLElement, opener: HTMLElement | null, onClose?: () => void) {
  return mountOverlay(panel, { opener, onClose });
}
