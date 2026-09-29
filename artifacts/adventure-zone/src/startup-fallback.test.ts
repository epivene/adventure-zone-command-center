import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { within } from "@testing-library/dom";

const source = readFileSync("index.html", "utf8");
afterEach(() => document.getElementById("root")?.remove());

describe("HTML startup fallback", () => {
  it.each([
    ["/", "https://app.example/assistant/workspace/one", "https://app.example/assistant/offline"],
    ["/office/", "https://app.example/office/assistant/workspace/one?view=draft", "https://app.example/office/assistant/offline"],
  ])("offers recovery without loading JavaScript or external assets at %s", (base, currentUrl, offlineUrl) => {
    // Vite substitutes BASE_URL at build time; parse only the document, with no scripts or styles fetched.
    const parsed = new DOMParser().parseFromString(source.replaceAll("%BASE_URL%", base), "text/html");
    const root = parsed.getElementById("root")!;
    document.body.append(root);
    const recovery = within(root);
    expect(recovery.getByRole("heading")).toBeInTheDocument();
    expect(recovery.getByText(/Prepare for offline/)).toBeInTheDocument();
    const retry = recovery.getByRole("link", { name: "Try again" });
    const saved = recovery.getByRole("link", { name: "Open saved offline workspace" });
    expect(new URL(retry.getAttribute("href")!, currentUrl).href).toBe(currentUrl);
    expect(new URL(saved.getAttribute("href")!, currentUrl).href).toBe(offlineUrl);
    expect(root.querySelector("img, iframe, script, link")).toBeNull();
  });
});
