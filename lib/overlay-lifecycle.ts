/** Single document-scoped lifecycle for custom overlays and native dialogs. */
export type OverlayOptions = {
  onClose?: () => void;
  initialFocus?: () => HTMLElement | null | undefined;
  opener?: HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
  lockScroll?: boolean;
  /** Only non-focusable backdrops may remain pointer-operable outside the panel. */
  backdrop?: string;
};
type Entry = { panel: HTMLElement; options: OverlayOptions; opener: HTMLElement | null; tabIndex: string | null };
type State = { entries: Entry[]; inert: Map<HTMLElement, boolean>; body: string; root: string; observer?: MutationObserver; stop: () => void };
const branches = new WeakMap<Document, Set<{ anchor: HTMLElement; panel: HTMLElement }>>();
function owned(entry: Entry) { return [...branches.get(entry.panel.ownerDocument) ?? []].filter(branch => entry.panel.contains(branch.anchor) && branch.panel.isConnected).map(branch => branch.panel); }
function contains(entry: Entry, node: Node | null) { return entry.panel.contains(node) || owned(entry).some(panel => panel.contains(node)); }
const documents = new WeakMap<Document, State>();
const FOCUSABLE = 'a[href],area[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]';

function hidden(node: HTMLElement, state: State): boolean {
  if (!node.isConnected) return true;
  for (let at: HTMLElement | null = node; at; at = at.parentElement) {
    if (at.hidden || at.getAttribute('aria-hidden') === 'true' || (at.inert && state.inert.get(at) !== false)) return true;
    if (at.tagName === 'DIALOG' && !(at as HTMLDialogElement).open) return true;
    const css = at.ownerDocument.defaultView?.getComputedStyle(at);
    if (css?.display === 'none' || css?.visibility === 'hidden' || css?.visibility === 'collapse') return true;
  }
  return false;
}
function top(state: State) { return state.entries.findLast(entry => !hidden(entry.panel, state)); }
function focusable(entry: Entry, state: State) {
  return [entry.panel, ...owned(entry)].flatMap(panel => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]).filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !hidden(node, state) && node.getClientRects().length > 0);
}
function focus(entry: Entry, state: State) {
  const initial = entry.options.initialFocus?.();
  const target = initial && entry.panel.contains(initial) && !hidden(initial, state) && !initial.matches(':disabled') ? initial : focusable(entry, state)[0] ?? entry.panel;
  target.focus({ preventScroll: true });
}
function restoreInert(state: State) {
  for (const [node, before] of state.inert) {
    // Persistent drawers set aria-hidden/inert together when closing under a
    // newer overlay. Do not undo that new closed state with the old snapshot.
    const closedDrawer = node.getAttribute('role') === 'dialog' && node.getAttribute('aria-hidden') === 'true';
    node.inert = closedDrawer ? true : before;
  }
  state.inert.clear();
}
function sync(doc: Document, state: State) {
  restoreInert(state);
  const entry = top(state);
  if (entry) {
    const allowed = [entry.panel, ...owned(entry)];
    for (const root of allowed) for (let branch: HTMLElement = root; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof doc.defaultView!.HTMLElement) || sibling === branch || sibling.hidden || sibling.getAttribute('aria-hidden') === 'true' || allowed.some(panel => sibling.contains(panel)) || sibling.matches('script,style,link') || (entry.options.backdrop && sibling.matches(entry.options.backdrop))) continue;
        if (!state.inert.has(sibling)) state.inert.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      if (branch.parentElement === doc.body) break;
    }
  }
  const locked = state.entries.some(item => item.options.lockScroll !== false && !hidden(item.panel, state));
  doc.body.style.overflow = locked ? 'hidden' : state.body;
  doc.documentElement.style.overflow = locked ? 'hidden' : state.root;
}

/** Idempotent cleanup, including out-of-order unmount and React StrictMode replay. */
export function mountOverlay(panel: HTMLElement, options: OverlayOptions = {}): () => void {
  const doc = panel.ownerDocument;
  let state = documents.get(doc);
  if (!state) {
    state = { entries: [], inert: new Map(), body: doc.body.style.overflow, root: doc.documentElement.style.overflow, stop: () => {} };
    documents.set(doc, state);
    const current = state;
    const onKey = (event: KeyboardEvent) => {
      const entry = top(current);
      if (!entry || event.defaultPrevented) return;
      // A portaled menu owns its arrows, Tab and Escape; it belongs to this focus scope.
      if (owned(entry).some(panel => panel.contains(doc.activeElement))) return;
      // Native showModal already owns keyboard scope and cancel; never dispatch a second close.
      if (entry.panel.tagName === 'DIALOG') return;
      if (event.key === 'Escape') { if (entry.options.onClose) { event.preventDefault(); event.stopPropagation(); entry.options.onClose(); } return; }
      if (event.key !== 'Tab') return;
      const items = focusable(entry, current);
      const index = items.indexOf(doc.activeElement as HTMLElement);
      if (!items.length) { event.preventDefault(); entry.panel.focus({ preventScroll: true }); }
      else if (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault(); (event.shiftKey ? items[items.length - 1] : items[0]).focus({ preventScroll: true });
      }
    };
    let recovering = false;
    const onFocus = () => {
      const entry = top(current);
      if (!recovering && entry && !contains(entry, doc.activeElement)) {
        const active = doc.activeElement as HTMLElement | null;
        const mounting = active?.closest<HTMLElement>('[role="dialog"][aria-modal="true"],dialog[open]');
        // React autoFocus runs during the commit before the parent's layout
        // effect can register the new scope. Preserve that focus for this commit.
        if (mounting && !current.entries.some(item => item.panel === mounting) && !hidden(mounting, current)) {
          queueMicrotask(() => {
            const next = top(current);
            if (next === entry && !contains(entry, doc.activeElement)) focus(entry, current);
          });
          return;
        }
        recovering = true; try { focus(entry, current); } finally { recovering = false; }
      }
    };
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('focusin', onFocus);
    const Observer = doc.defaultView?.MutationObserver;
    if (Observer) {
      // Exclude inert: these mutations are our own reconciliation, not a new overlay.
      current.observer = new Observer(() => { sync(doc, current); onFocus(); });
      current.observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'open'] });
    }
    current.stop = () => { doc.removeEventListener('keydown', onKey); doc.removeEventListener('focusin', onFocus); current.observer?.disconnect(); };
  }
  const entry: Entry = { panel, options, opener: options.opener === undefined ? doc.activeElement as HTMLElement | null : options.opener, tabIndex: panel.getAttribute('tabindex') };
  state.entries.push(entry);
  if (panel.tabIndex < 0 && !panel.hasAttribute('tabindex')) panel.tabIndex = -1;
  sync(doc, state);
  if (top(state) === entry && !contains(entry, doc.activeElement)) focus(entry, state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const wasTop = top(state!) === entry || state!.entries[state!.entries.length - 1] === entry;
    state!.entries = state!.entries.filter(item => item !== entry);
    // A child whose opener belonged to the removed parent inherits its original opener.
    for (const remaining of state!.entries) if (remaining.opener && panel.contains(remaining.opener)) remaining.opener = entry.opener;
    if (entry.tabIndex === null) panel.removeAttribute('tabindex');
    sync(doc, state!);
    const next = top(state!);
    if (!state!.entries.length) { state!.stop(); documents.delete(doc); }
    if (!wasTop) return;
    const opener = entry.opener;
    if (opener && !hidden(opener, state!) && (!next || contains(next, opener))) opener.focus({ preventScroll: true });
    else if (next && !contains(next, doc.activeElement)) focus(next, state!);
    else if (!next) {
      const fallback = options.fallbackFocus?.();
      if (fallback && !hidden(fallback, state!)) fallback.focus({ preventScroll: true });
    }
  };
}

/** Nonmodal portaled menu stays within the originating dialog's accessible scope.
 * Its own menu keyboard/close semantics are intentionally retained. */
export function mountOverlayBranch(anchor: HTMLElement, panel: HTMLElement): () => void {
  const doc = anchor.ownerDocument;
  let items = branches.get(doc);
  if (!items) { items = new Set(); branches.set(doc, items); }
  const item = { anchor, panel }; items.add(item);
  const state = documents.get(doc); if (state) sync(doc, state);
  return () => { items!.delete(item); const current = documents.get(doc); if (current) sync(doc, current); };
}
