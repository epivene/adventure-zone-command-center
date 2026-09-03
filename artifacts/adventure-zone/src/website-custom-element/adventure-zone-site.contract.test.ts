import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const source = readFileSync("public/adventure-zone-site.js", "utf8");
const originalFetch = globalThis.fetch;

function flush() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function mountForm() {
  const element = document.createElement("adventure-zone-site") as HTMLElement;
  document.body.append(element);
  const root = element.shadowRoot!;
  const form = root.querySelector<HTMLFormElement>(".contact-form")!;
  const set = (name: string, value: string) => {
    const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    field.value = value;
  };
  set("name", "Desie Leigh");
  set("email", "desie@example.com");
  set("eventName", "Summer Festival");
  set("eventDate", "2026-07-04");
  set("eventLocation", "Denver, CO");
  set("packageInterest", "Adventure Zone");
  set("message", "Please bring the full Adventure Zone.");
  return { element, root, form, set };
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => { callback(0); return 1; },
  });
  window.eval(source);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("adventure-zone-site inquiry contract", () => {
  it("registers the Wix custom element", () => {
    expect(customElements.get("adventure-zone-site")).toBeTypeOf("function");
  });

  it("keeps measured page heights independent from the Wix iframe viewport", () => {
    const element = document.createElement("adventure-zone-site") as HTMLElement;
    document.body.append(element);
    const embeddedStyles = element.shadowRoot?.querySelector("style")?.textContent;
    expect(embeddedStyles).toBeTruthy();

    const stylesheet = document.createElement("style");
    stylesheet.textContent = embeddedStyles ?? "";
    document.body.append(stylesheet);

    const measuredMinHeights: string[] = [];
    const visitRules = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSStyleRule &&
          rule.selectorText
            .split(",")
            .some((selector) => [".az-site", ".hero"].includes(selector.trim()))
        ) {
          if (rule.style.minHeight) measuredMinHeights.push(rule.style.minHeight);
        }
        const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (nestedRules) visitRules(nestedRules);
      }
    };
    visitRules(stylesheet.sheet!.cssRules);

    expect(measuredMinHeights).not.toHaveLength(0);
    expect(measuredMinHeights.join(" ")).not.toMatch(/\b\d*\.?\d+(?:s|d|l)?vh\b/i);
  });

  it("uses a compact desktop treatment at Wix's 980px canvas width", () => {
    const element = document.createElement("adventure-zone-site") as HTMLElement;
    document.body.append(element);
    const stylesheet = document.createElement("style");
    stylesheet.textContent = element.shadowRoot?.querySelector("style")?.textContent ?? "";
    document.body.append(stylesheet);

    const canvasWidth = 980;
    const applicableRules: CSSStyleRule[] = [];
    const visitRules = (rules: CSSRuleList, applies = true) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && applies) applicableRules.push(rule);
        if (rule instanceof CSSMediaRule) {
          const minWidth = /min-width:\s*(\d+)px/.exec(rule.conditionText)?.[1];
          visitRules(rule.cssRules, applies && (!minWidth || Number(minWidth) <= canvasWidth));
        }
      }
    };
    visitRules(stylesheet.sheet!.cssRules);

    const finalStyle = (selector: string, property: keyof CSSStyleDeclaration) => {
      const rule = applicableRules
        .filter((candidate) => candidate.selectorText.split(",").some((part) => part.trim() === selector))
        .at(-1);
      return rule?.style[property] as string | undefined;
    };
    const toPixels = (token: string) => {
      const value = Number.parseFloat(token);
      if (token.endsWith("rem")) return value * 16;
      if (token.endsWith("vw")) return value * canvasWidth / 100;
      return value;
    };
    const resolveClamp = (value: string | undefined) => {
      const parts = /^clamp\(([^,]+),\s*([^,]+),\s*([^\)]+)\)$/.exec(value ?? "");
      expect(parts, `Expected a clamp() value, received ${value}`).not.toBeNull();
      return Math.max(toPixels(parts![1]!), Math.min(toPixels(parts![2]!), toPixels(parts![3]!)));
    };

    expect(resolveClamp(finalStyle(".hero h1", "fontSize"))).toBeLessThanOrEqual(90);
    expect(resolveClamp(finalStyle(".section h2", "fontSize"))).toBeLessThanOrEqual(60);
    expect(resolveClamp(finalStyle(".hero", "minHeight"))).toBeLessThanOrEqual(660);
    expect(finalStyle(".desktop-nav", "display")).toBe("flex");
  });

  it("posts every form field, the honeypot, page URL, and one submission ID", async () => {
    const randomUUID = vi.fn(() => "10000000-0000-4000-8000-000000000001");
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: randomUUID });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ referenceCode: "AZI-2026-ABC12345", message: "Your inquiry was received." }), { status: 201, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;
    const { form } = mountForm();
    submit(form);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://adventure-zone-command-center.onrender.com/api/public/website-inquiries");
    expect(JSON.parse(String(request.body))).toEqual({
      submissionId: "10000000-0000-4000-8000-000000000001",
      name: "Desie Leigh",
      email: "desie@example.com",
      eventName: "Summer Festival",
      eventDate: "2026-07-04",
      eventLocation: "Denver, CO",
      packageInterest: "Adventure Zone",
      message: "Please bring the full Adventure Zone.",
      website: "",
      pageUrl: window.location.href,
    });
  });

  it("reuses one UUID after failure and disables only the submit button while pending", async () => {
    const randomUUID = vi.fn(() => "10000000-0000-4000-8000-000000000002");
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: randomUUID });
    let rejectFirst!: (error: Error) => void;
    const first = new Promise((_resolve, reject) => { rejectFirst = reject; });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(new Response(JSON.stringify({ referenceCode: "AZI-2026-DONE", message: "Saved." }), { status: 201, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;
    const { form } = mountForm();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit(form);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/sending/i);
    expect((form.elements.namedItem("name") as HTMLInputElement)).not.toBeDisabled();
    rejectFirst(new Error("offline"));
    await flush();
    submit(form);
    await flush();
    const bodies = fetchMock.mock.calls.map(([, request]) => JSON.parse(String(request.body)));
    expect(bodies[0].submissionId).toBe(bodies[1].submissionId);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("resets fields and the retry UUID only after a successful save", async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000004");
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: randomUUID });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ referenceCode: "AZI-2026-SAVED", message: "Saved." }), { status: 201, headers: { "Content-Type": "application/json" } }));
    const { form, set } = mountForm();
    submit(form);
    await flush();
    expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("");
    expect(form.parentElement?.querySelector(".status-slot")).toHaveTextContent(/AZI-2026-SAVED|Saved/);

    set("name", "Second Person");
    set("email", "second@example.com");
    set("eventName", "Second Event");
    set("message", "Second inquiry message.");
    submit(form);
    await flush();
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(JSON.parse(String(calls[0]![1]!.body)).submissionId).not.toBe(JSON.parse(String(calls[1]![1]!.body)).submissionId);
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("offline"))],
    ["server failure", () => Promise.resolve(new Response("no", { status: 503 }))],
    ["validation failure", () => Promise.resolve(new Response("no", { status: 400 }))],
  ])("keeps values and renders an email fallback after %s", async (_label, response) => {
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: () => "10000000-0000-4000-8000-000000000005" });
    globalThis.fetch = vi.fn(response);
    const { root, form } = mountForm();
    submit(form);
    await flush();
    expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("Desie Leigh");
    const fallback = root.querySelector<HTMLAnchorElement>('a[href^="mailto:TheAdventureZone12@gmail.com"]');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent(/email/i);
  });

  it("aborts a timed-out request while preserving the form and email fallback", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => "10000000-0000-4000-8000-000000000006",
    });
    globalThis.fetch = vi.fn((_url, request) => new Promise((_resolve, reject) => {
      request?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Request timed out", "AbortError")),
        { once: true },
      );
    }));
    const { root, form } = mountForm();
    submit(form);

    await vi.advanceTimersByTimeAsync(12_000);

    expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("Desie Leigh");
    expect(root.querySelector('a[href^="mailto:TheAdventureZone12@gmail.com"]')).not.toBeNull();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')).not.toBeDisabled();
  });

  it("contains no Replit dependency, navigation fallback, or embedded secret configuration", () => {
    expect(source).not.toMatch(/replit\.app/i);
    expect(source).not.toMatch(/window\.location\.href\s*=/);
    expect(source).not.toMatch(/window\.location\.(?:assign|replace)\s*\(/);
    expect(source).not.toMatch(/DATABASE_URL|SESSION_SECRET|SMTP(?:_|\s).*PASS|WEBSITE_INQUIRY_ALERT_RECIPIENTS/i);
  });
});
