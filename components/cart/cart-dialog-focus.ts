/** Mismo recorrido de foco que el drawer canónico de AdminShell, sin acoplar
 * el carrito público al shell autenticado. Recalcula controles tras cada cambio. */
export function mountCartDialogFocus(panel: HTMLElement, opener: HTMLElement | null) {
  const doc = panel.ownerDocument;
  const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]'))
    .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]") && element.getClientRects().length > 0);
  const initialFocus = () => (focusable()[0] ?? panel).focus({ preventScroll: true });
  const containFocus = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = focusable();
    const index = items.indexOf(doc.activeElement as HTMLElement);
    if (!items.length) { event.preventDefault(); panel.focus({ preventScroll: true }); return; }
    if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus({ preventScroll: true });
    }
  };
  const recoverFocus = () => { if (!panel.contains(doc.activeElement)) initialFocus(); };
  doc.addEventListener("keydown", containFocus, true);
  doc.addEventListener("focusin", recoverFocus);
  initialFocus();
  return () => {
    doc.removeEventListener("keydown", containFocus, true);
    doc.removeEventListener("focusin", recoverFocus);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
}
