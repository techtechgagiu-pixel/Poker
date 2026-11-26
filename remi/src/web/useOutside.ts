import { RefObject, useEffect, useRef } from 'react';

/**
 * Close a panel when the user presses anywhere outside it.
 * `ignore` = selector of elements that toggle the panel themselves (so a press on them doesn't close-then-reopen).
 */
export function useClickOutside(ref: RefObject<HTMLElement>, onClose: () => void, ignore?: string, enabled = true) {
  const cb = useRef(onClose); cb.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || !ref.current || ref.current.contains(t)) return;
      if (ignore && t.closest(ignore)) return;
      cb.current();
    };
    // attach after the opening press has finished
    const id = window.setTimeout(() => document.addEventListener('pointerdown', h, true), 0);
    return () => { clearTimeout(id); document.removeEventListener('pointerdown', h, true); };
  }, [ref, ignore, enabled]);
}
