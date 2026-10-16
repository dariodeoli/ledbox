"use client";
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { mountOverlay } from '@/lib/overlay-lifecycle';
export function useModalBehavior(panel: RefObject<HTMLElement | null>, onClose: () => void, options: { initialFocus?: RefObject<HTMLElement | null>; opener?: RefObject<HTMLElement | null>; fallbackFocus?: () => HTMLElement | null; lockScroll?: boolean; enabled?: boolean } = {}) {
  const close = useRef(onClose);
  close.current = onClose;
  const enabled = options.enabled !== false;
  // Capture before child autoFocus runs in the DOM commit (including a drawer
  // kept mounted while closed); effects run too late to identify its opener.
  const opener = useRef<HTMLElement | null>(null);
  const wasEnabled = useRef(false);
  if (enabled && !wasEnabled.current) opener.current = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
  wasEnabled.current = enabled;
  useLayoutEffect(() => {
    if (!enabled || !panel.current) return;
    return mountOverlay(panel.current, { onClose: () => close.current(), initialFocus: () => options.initialFocus?.current, opener: options.opener ? options.opener.current : opener.current, fallbackFocus: options.fallbackFocus, lockScroll: options.lockScroll });
    // Refs and close callback are read at activation/use; content edits do not reopen the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
