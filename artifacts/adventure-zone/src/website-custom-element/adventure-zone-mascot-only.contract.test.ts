import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const releasePath = "public/adventure-zone-mascot-20260904-v1.js";

describe("desktop mascot release contract", () => {
  it("registers the mascot without competing for the main site tag", () => {
    const exists = existsSync(releasePath);
    expect(exists).toBe(true);
    if (!exists) return;

    const definitions = new Map<string, CustomElementConstructor>();
    const customElements = {
      get: (name: string) => definitions.get(name),
      define: (name: string, constructor: CustomElementConstructor) => definitions.set(name, constructor),
    };

    runInNewContext(readFileSync(releasePath, "utf8"), {
      customElements,
      HTMLElement: class {},
    });

    expect(definitions.has("adventure-zone-mascot")).toBe(true);
    expect(definitions.has("adventure-zone-site")).toBe(false);
  });
});
