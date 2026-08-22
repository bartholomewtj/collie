import { useSyncExternalStore } from "react";

export type DesktopTyping = "composer" | "direct";
export interface DesktopPrefs { on: boolean; typing: DesktopTyping }

const STORAGE_KEY = "collie:desktop:v1";
const DEFAULTS: DesktopPrefs = { on: false, typing: "composer" };
let prefs: DesktopPrefs | undefined;
const listeners = new Set<() => void>();

function load(): DesktopPrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    return { on: parsed.on === true, typing: parsed.typing === "direct" ? "direct" : "composer" };
  } catch { return { ...DEFAULTS }; }
}
function current(): DesktopPrefs { return (prefs ??= load()); }
function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current())); } catch { /* memory remains authoritative */ }
  listeners.forEach((fn) => fn());
}
export function desktopPrefs(): DesktopPrefs { return current(); }
export function setDesktop(on: boolean): void { prefs = { ...current(), on }; save(); }
export function setTyping(typing: DesktopTyping): void { prefs = { ...current(), typing }; save(); }
export function useDesktop(): DesktopPrefs {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, desktopPrefs, () => DEFAULTS);
}
export function __resetDesktop(): void { prefs = undefined; try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } listeners.forEach((fn) => fn()); }
