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

function mountSite() {
  const element = document.createElement("adventure-zone-site") as HTMLElement;
  document.body.append(element);
  return { element, root: element.shadowRoot! };
}

function applicableStyle(root: ShadowRoot, selector: string, canvasWidth = 980) {
  const stylesheet = document.createElement("style");
  stylesheet.textContent = root.querySelector("style")?.textContent ?? "";
  document.body.append(stylesheet);
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
  const cascaded = document.createElement("div").style;
  applicableRules
    .filter((rule) => rule.selectorText.split(",").some((part) => part.trim() === selector))
    .forEach((rule) => {
      for (const property of Array.from(rule.style)) {
        cascaded.setProperty(property, rule.style.getPropertyValue(property), rule.style.getPropertyPriority(property));
      }
    });
  return cascaded;
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
  window.history.replaceState({}, "", "/");
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

  it("renders one complete hosted tube-man mascot without crop styling", () => {
    const mascot = document.createElement("adventure-zone-mascot") as HTMLElement;
    document.body.append(mascot);
    const root = mascot.shadowRoot!;
    const mascots = root.querySelectorAll<HTMLImageElement>(".tube-man-image");
    const { root: siteRoot } = mountSite();

    expect(mascots).toHaveLength(1);
    expect(mascots[0]?.getAttribute("src")).toBe(
      "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-mascot.png",
    );
    expect(applicableStyle(root, ".tube-man-image")?.width).toBe("100%");
    expect(applicableStyle(root, ".tube-man-image")?.height).toBe("100%");
    expect(applicableStyle(root, ".tube-man-image")?.objectFit).toBe("contain");
    expect(applicableStyle(root, ".tube-man-image")?.clipPath).toBe("");
    expect(applicableStyle(root, ".tube-man-image")?.mask).toBe("");
    expect(applicableStyle(root, ".mascot-shell")?.overflow).not.toBe("hidden");
    expect(applicableStyle(root, ".mascot-shell")?.transform).toBe("translateY(3px)");
    expect(applicableStyle(root, ":host")?.position).toBe("fixed");
    expect(applicableStyle(root, ":host")?.bottom).toBe("0px");
    expect(siteRoot.querySelectorAll(".tube-man-image")).toHaveLength(0);
  });

  it.each([
    ["adventure-zone-mascot.png", 408, 612],
    ["rmaf-logo.png", 492, 274],
    ["waf-logo.png", 1197, 1197],
  ])("ships the complete hosted PNG asset %s", (filename, expectedWidth, expectedHeight) => {
    const png = readFileSync(`public/assets/${filename}`);

    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(expectedWidth);
    expect(png.readUInt32BE(20)).toBe(expectedHeight);
  });

  it("shows the current crew with names and roles on Wix's desktop canvas", () => {
    const { root } = mountSite();
    const bubbles = Array.from(root.querySelectorAll<HTMLElement>(".team-bubble"));
    const names = bubbles.map((bubble) => bubble.querySelector(".team-name")?.textContent?.trim());

    expect(names).toEqual([
      "Dave",
      "Amy",
      "The Toy Guy & Queen La-La",
      "Spaz",
      "Hulk",
      "Junior",
      "Sheera",
      "Mikey",
      "Angelo",
      "Mouth",
      "Desiree",
    ]);
    expect(root.textContent).not.toContain("Tristan");
    expect(bubbles.find((bubble) => bubble.querySelector(".team-name")?.textContent === "Desiree")?.querySelector(".team-role"))
      .toHaveTextContent("Marketing & Booking");
    expect(bubbles.every((bubble) => bubble.querySelector(".team-name + .team-role"))).toBe(true);
    expect(applicableStyle(root, ".team-float")?.display).toBe("block");
    expect(applicableStyle(root, ".team-label")?.display).toBe("block");
  });

  it("keeps the booking action and menu available without overflowing Wix's 980px canvas", () => {
    const { root } = mountSite();

    expect(applicableStyle(root, ".desktop-nav", 980).display).toBe("none");
    expect(applicableStyle(root, ".desktop-book", 980).display).toBe("flex");
    expect(applicableStyle(root, ".menu-toggle", 980).display).toBe("inline-flex");
    expect(Number.parseFloat(applicableStyle(root, ".logo", 980).width)).toBeLessThanOrEqual(180);
    expect(applicableStyle(root, ".desktop-book .button", 980).padding).toBe("10px 14px");
    expect(Number.parseFloat(applicableStyle(root, ".desktop-book .button", 980).fontSize)).toBeLessThanOrEqual(11);
    expect(applicableStyle(root, ".desktop-nav", 1280).display).toBe("flex");
    expect(applicableStyle(root, ".menu-toggle", 1280).display).toBe("none");
  });

  it("shows every crew member without overlap below the hero in Wix's iframe preview", () => {
    window.history.replaceState({}, "", "/CustomElementPreviewIframe.preview.html");
    const { root } = mountSite();
    const shell = root.querySelector<HTMLElement>(".az-site")!;
    const teamStyle = applicableStyle(root, ".az-site.wix-preview-frame .team-float");
    const rightTeamStyle = applicableStyle(root, ".az-site.wix-preview-frame .team-bubble[style*='right:']");
    const previewHeaderStyle = applicableStyle(root, ".az-site.wix-preview-frame .site-header .container", 980);
    const visibleBubbles = Array.from(root.querySelectorAll<HTMLElement>(".team-bubble.visible"));
    const visibleTeamIndexes = visibleBubbles.map((bubble) => bubble.dataset.teamIndex);
    const visiblePositions = visibleBubbles.map((bubble) => `${bubble.style.left}|${bubble.style.right}|${bubble.style.top}`);

    expect(shell).toHaveClass("wix-preview-frame");
    expect(teamStyle.position).toBe("absolute");
    expect(Number.parseFloat(teamStyle.top)).toBeGreaterThanOrEqual(620);
    expect(Number.parseFloat(rightTeamStyle.right)).toBeGreaterThanOrEqual(100);
    expect(previewHeaderStyle.width).toBe("calc(100% - 144px)");
    expect(visibleTeamIndexes).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(new Set(visiblePositions).size).toBe(11);
  });

  it("reveals team bubbles in waves only after scrolling below the hero", () => {
    const { root } = mountSite();
    const hero = root.querySelector<HTMLElement>("#hero")!;
    let heroBottom = 700;
    hero.getBoundingClientRect = () => ({ bottom: heroBottom }) as DOMRect;
    Object.defineProperty(hero, "offsetHeight", { configurable: true, value: 700 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });

    window.dispatchEvent(new Event("scroll"));
    expect(root.querySelectorAll(".team-bubble.visible")).toHaveLength(0);

    heroBottom = 80;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("scroll"));
    expect(Array.from(root.querySelectorAll<HTMLElement>(".team-bubble.visible")).map((bubble) => bubble.dataset.teamIndex))
      .toEqual(["0", "2", "5"]);
  });

  it("renders collapsed package-specific attraction lineups", () => {
    const { root } = mountSite();
    const expectedLineups = new Map<string, string[]>([
      ["Adventure Zone", [
        "Princess Palace", "Castle Fortress", "SpongeBob Ahoy", "Under the Sea Grotto",
        "Blue Wave", "Island Tropics", "Athletes & Sports", "Polar Bear", "Jungle Tiger", "Mountain Top",
        "Dual & Single Lane", "1/2 Pipe", "Take Me Out to the Ball Game", "Screamer",
        "Boulder Dash", "Jousting Arena", "Gladiator Pit", "The Gauntlet",
        "Adrenaline Rush", "Super Obstacle Course", "Everest", "Radical Run", "Boot Camp Challenge", "Jungle Trek Xtreme",
        "Bungee Run", "Eliminator", "Wrecking Ball",
        "Balloon Darts", "Ring Toss", "Basket Toss", "Bean Bag Toss", "Fish Pond", "Mystery Bag",
      ]],
      ["Pirate's Rebellion", [
        "2,500 sq ft Pool", "6 Pedal-Style Bumper Boats", "Hundreds of Sponges", "Over 25' Tall", "Bounce House with Attached Slide",
      ]],
      ["Warrior's Playground", [
        "Adrenaline Rush", "Super Obstacle Course", "Everest", "Radical Run", "Boot Camp Challenge", "Jungle Trek Xtreme",
        "Bungee Run", "Eliminator", "Wrecking Ball",
        "Balloon Darts", "Ring Toss", "Basket Toss", "Bean Bag Toss", "Fish Pond", "Mystery Bag",
      ]],
    ]);
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".package-card"));

    expect(cards).toHaveLength(3);
    for (const card of cards) {
      const title = card.querySelector("h3")?.textContent?.trim() ?? "";
      const lineup = card.querySelector<HTMLDetailsElement>("details.attraction-lineup")!;
      expect(lineup).not.toHaveAttribute("open");
      expect(lineup.querySelector("summary")).toHaveTextContent("View Attraction Lineup");
      expect(lineup.querySelector(".attraction-lineup-intro")).toHaveTextContent(
        "Packages include a curated selection; attractions are not available a la carte.",
      );
      expect(Array.from(lineup.querySelectorAll(".attraction-chip-list span")).map((chip) => chip.textContent?.trim()))
        .toEqual(expectedLineups.get(title));
    }
    expect(cards[0]?.querySelector(".package-title-copy p")).toHaveTextContent("Something for everyone.");
  });

  it("renders the booking arrangements and hosted Proud Members logos", () => {
    const { root } = mountSite();
    const bookingCopy = root.querySelector("#partnerships")?.textContent ?? "";
    const memberBadge = root.querySelector(".member-badge")!;
    const memberImages = Array.from(memberBadge.querySelectorAll<HTMLImageElement>("img"));

    expect(bookingCopy).toContain("percentage-of-sales");
    expect(bookingCopy).toContain("guaranteed-payment arrangements");
    expect(memberBadge).toHaveTextContent("Proud Members");
    expect(memberImages.map((image) => image.getAttribute("src"))).toEqual([
      "https://adventure-zone-command-center-1.onrender.com/assets/rmaf-logo.png",
      "https://adventure-zone-command-center-1.onrender.com/assets/waf-logo.png",
    ]);
    expect(memberImages.map((image) => image.alt)).toEqual([
      "Rocky Mountain Association of Fairs logo",
      "Western Fairs Association logo",
    ]);

    const assetUrls = Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img[src], video[src]"))
      .map((element) => element.getAttribute("src"));
    const posterUrls = Array.from(root.querySelectorAll<HTMLVideoElement>("video[poster]"))
      .map((element) => element.getAttribute("poster"));
    expect([...assetUrls, ...posterUrls].every((url) => url?.startsWith("https://"))).toBe(true);
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
    expect(finalStyle(".desktop-nav", "display")).toBe("none");
  });

  it("keeps the rotated promo banner below the fixed header on Wix's desktop canvas", () => {
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

    const heroRule = applicableRules
      .filter((candidate) => candidate.selectorText.split(",").some((part) => part.trim() === ".hero"))
      .at(-1);
    const padding = heroRule?.style.padding.split(/\s+/).map(Number.parseFloat);
    expect(padding).toHaveLength(3);

    const [paddingTop, , paddingBottom] = padding!;
    const heroHeight = 620;
    const heroContentHeight = 404.72;
    const rotatedBannerRise = 10.96;
    const fixedHeaderHeight = 122;
    const requiredClearance = 8;
    const centeredContentTop = paddingTop! + (
      heroHeight - paddingTop! - paddingBottom! - heroContentHeight
    ) / 2;
    const promoBannerTop = centeredContentTop - rotatedBannerRise;

    expect(promoBannerTop - fixedHeaderHeight).toBeGreaterThanOrEqual(requiredClearance);
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
