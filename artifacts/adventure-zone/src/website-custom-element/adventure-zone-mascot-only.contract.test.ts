import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const releasePath = "public/adventure-zone-mascot-20260904-v2.js";

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

    class FakeHTMLElement {
      shadowRoot: { innerHTML: string } | null = null;

      attachShadow() {
        this.shadowRoot = { innerHTML: "" };
        return this.shadowRoot;
      }
    }

    runInNewContext(readFileSync(releasePath, "utf8"), {
      customElements,
      HTMLElement: FakeHTMLElement,
    });

    expect(definitions.has("adventure-zone-mascot")).toBe(true);
    expect(definitions.has("adventure-zone-site")).toBe(false);

    const Mascot = definitions.get("adventure-zone-mascot")!;
    const mascot = new Mascot() as FakeHTMLElement & { connectedCallback(): void };
    mascot.connectedCallback();
    expect(mascot.shadowRoot?.innerHTML).toContain(
      ":host { position: fixed; right: 0; bottom: 0; left: auto; display: block; width: 130px; height: 230px;",
    );
    expect(mascot.shadowRoot?.innerHTML).toContain(
      "@media (max-width: 767px) { :host { display: none; } }",
    );
  });
});
