import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  readAppearance,
  saveAppearance,
} from "./appearance";

function storage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

function root() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
    dataset: {} as DOMStringMap,
  } as unknown as HTMLElement;
}

describe("per-device appearance", () => {
  it("defaults to light and reads only supported local values", () => {
    expect(readAppearance(storage())).toBe("light");
    expect(readAppearance(storage({ [APPEARANCE_STORAGE_KEY]: "warm-light" }))).toBe("light");
    expect(readAppearance(storage({ [APPEARANCE_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(readAppearance(storage({ [APPEARANCE_STORAGE_KEY]: "something-else" }))).toBe("light");
  });

  it("stores appearance only in the supplied browser storage", () => {
    const firstDevice = storage();
    const secondDevice = storage();
    saveAppearance("dark", firstDevice);
    expect(readAppearance(firstDevice)).toBe("dark");
    expect(readAppearance(secondDevice)).toBe("light");
  });

  it("applies mutually exclusive light and dark root classes", () => {
    const element = root();
    applyAppearance("dark", element);
    expect(element.classList.contains("dark")).toBe(true);
    applyAppearance("light", element);
    expect(element.classList.contains("dark")).toBe(false);
  });
});
