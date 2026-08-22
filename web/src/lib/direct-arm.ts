// A one-shot request bridge for the desktop Ctrl+` chord. Armed state remains owned by the composer.
const listeners = new Set<() => void>();

export function onArmToggleRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function requestArmToggle(): void {
  for (const fn of listeners) fn();
}
