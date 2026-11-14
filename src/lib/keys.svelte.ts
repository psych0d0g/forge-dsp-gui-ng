// Keyboard shortcuts (#24, after the list of the ETON Control Center). All are off while the focus
// is in a field. The page on screen can take keys first (pageKeys), the rest is global (App.svelte).
// The overview of all of them: Shortcuts.svelte, "?" or the link in the footer.

/** keys of the page on screen; returns true when it took the key */
export const pageKeys: { fn: ((e: KeyboardEvent) => boolean) | null } = { fn: null };

export const shortcuts = $state({ open: false, phaseKey: false });

/** typing goes to the field, not to the shortcuts */
export function inField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
