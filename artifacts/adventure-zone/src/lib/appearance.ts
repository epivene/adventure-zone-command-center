export type Appearance = "light" | "warm-light" | "dark";

export const APPEARANCE_STORAGE_KEY = "adventure-zone:appearance";

const supported = new Set<Appearance>(["light", "warm-light", "dark"]);

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function browserRoot(): HTMLElement | undefined {
  try {
    return typeof document === "undefined" ? undefined : document.documentElement;
  } catch {
    return undefined;
  }
}

export function readAppearance(storage = browserStorage()): Appearance {
  if (!storage) return "light";
  try {
    const value = storage.getItem(APPEARANCE_STORAGE_KEY) as Appearance | null;
    return value && supported.has(value) ? value : "light";
  } catch {
    return "light";
  }
}

export function applyAppearance(appearance: Appearance, root = browserRoot()): void {
  if (!root) return;
  root.classList.remove("dark", "warm-light");
  if (appearance === "dark") root.classList.add("dark");
  if (appearance === "warm-light") root.classList.add("warm-light");
  root.dataset.appearance = appearance;
}

export function saveAppearance(
  appearance: Appearance,
  storage = browserStorage(),
  root = browserRoot(),
): void {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    // Appearance is optional UI state; storage failures must not block the app.
  }
  applyAppearance(appearance, root);
}

export function initializeAppearance(): Appearance {
  const appearance = readAppearance();
  applyAppearance(appearance);
  return appearance;
}
