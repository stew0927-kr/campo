// Keyboard shortcuts as a table (SPEC-v0.2 5.3): the first binding that matches the key runs.
import { useEffect, useRef } from 'react';

export interface KeyBinding {
  /** KeyboardEvent.key in lower case: "z", "delete", "escape", "[". */
  key: string;
  /** true: Ctrl or Cmd must be held. false (default): neither Ctrl, Cmd nor Alt. 'any': modifiers are not looked at. */
  mod?: boolean | 'any';
  /** Shift must be held (true) or must not be (false); left out, it does not matter. */
  shift?: boolean;
  /** The binding only counts while this holds (e.g. the 선택 tool is active). */
  when?: boolean;
  /** Leave the browser's own handling of the key alone. */
  keepDefault?: true;
  run: () => void;
}

function matches(b: KeyBinding, e: KeyboardEvent): boolean {
  if (b.when === false || b.key !== e.key.toLowerCase()) return false;
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false;
  if (b.mod === 'any') return true;
  const mod = e.ctrlKey || e.metaKey;
  return b.mod ? mod : !mod && !e.altKey;
}

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/** Listens once on the window; `bindings` may be rebuilt on every render. Keys typed into a field, or while a dialog is open, are left alone. */
export function useShortcuts(bindings: KeyBinding[]): void {
  const latest = useRef(bindings);
  latest.current = bindings;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (TYPING_TAGS.includes(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      const hit = latest.current.find((b) => matches(b, e));
      if (!hit) return;
      if (!hit.keepDefault) e.preventDefault();
      hit.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
