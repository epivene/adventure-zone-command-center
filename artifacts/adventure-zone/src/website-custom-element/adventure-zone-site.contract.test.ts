import { existsSync, readFileSync } from "node:fs";
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
  const filterMediaRules = (css: string): string => {
    let output = "";
    let cursor = 0;
    while (cursor < css.length) {
      const mediaStart = css.indexOf("@media", cursor);
      if (mediaStart === -1) return output + css.slice(cursor);
      output += css.slice(cursor, mediaStart);
      const openBrace = css.indexOf("{", mediaStart);
      if (openBrace === -1) return output + css.slice(mediaStart);
      let depth = 1;
      let closeBrace = openBrace + 1;
      while (closeBrace < css.length && depth > 0) {
        if (css[closeBrace] === "{") depth += 1;
        if (css[closeBrace] === "}") depth -= 1;
        closeBrace += 1;
      }
      const condition = css.slice(mediaStart + 6, openBrace);
      const minWidth = /min-width:\s*(\d+)px/.exec(condition)?.[1];
      const maxWidth = /max-width:\s*(\d+)px/.exec(condition)?.[1];
      const applies = (!minWidth || Number(minWidth) <= canvasWidth)
        && (!maxWidth || Number(maxWidth) >= canvasWidth);
      if (applies) output += filterMediaRules(css.slice(openBrace + 1, closeBrace - 1));
      cursor = closeBrace;
    }
    return output;
  };
  const stylesheet = document.createElement("style");
  const rawStyles = root.querySelector("style")?.textContent ?? "";
  const filteredStyles = filterMediaRules(rawStyles);
  stylesheet.textContent = filteredStyles;
  document.body.append(stylesheet);
  const applicableRules: CSSStyleRule[] = [];
  const visitRules = (rules: CSSRuleList, applies = true) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && applies) applicableRules.push(rule);
      if (rule instanceof CSSMediaRule) {
        const mediaText = rule.conditionText
          || rule.media?.mediaText
          || /^@media\s*([^\{]+)/.exec(rule.cssText)?.[1]
          || "";
        const minWidth = /min-width:\s*(\d+)px/.exec(mediaText)?.[1];
        const maxWidth = /max-width:\s*(\d+)px/.exec(mediaText)?.[1];
        visitRules(
          rule.cssRules,
          applies
            && (!minWidth || Number(minWidth) <= canvasWidth)
            && (!maxWidth || Number(maxWidth) >= canvasWidth),
        );
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

  it("renders complete hosted tube-man mascots for the pinned desktop and inline mobile layouts", () => {
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
    expect(applicableStyle(root, ":host")?.right).toBe("0px");
    expect(applicableStyle(root, ":host")?.bottom).toBe("0px");
    expect(applicableStyle(root, ":host")?.left).toBe("auto");
    expect(applicableStyle(root, ":host")?.width).toBe("130px");
    expect(applicableStyle(root, ":host")?.height).toBe("230px");
    expect(applicableStyle(root, ":host", 320)?.left).toBe("0px");
    expect(applicableStyle(root, ":host", 320)?.width).toBe("100%");
    expect(applicableStyle(root, ":host", 320)?.height).toBe("100%");
    const inlineMascots = siteRoot.querySelectorAll<HTMLImageElement>(".tube-man-position .tube-man-image");
    expect(inlineMascots).toHaveLength(1);
    expect(inlineMascots[0]?.getAttribute("src")).toBe(
      "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-mascot.png",
    );
    expect(siteRoot.querySelector(".tube-man-position")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps one embedded mascot on the right for phone and foldable widths, then hides it on desktop", () => {
    const { root } = mountSite();

    expect(applicableStyle(root, ".tube-man-position", 320).display).not.toBe("none");
    expect(applicableStyle(root, ".tube-man-position", 320).right).toBe("6px");
    expect(applicableStyle(root, ".tube-man-position", 320).left).toBe("auto");
    expect(applicableStyle(root, ".tube-man-position", 720).display).not.toBe("none");
    expect(applicableStyle(root, ".tube-man-position", 720).right).toBe("12px");
    expect(applicableStyle(root, ".tube-man-position", 720).left).toBe("auto");
    expect(applicableStyle(root, ".tube-man-position", 768).display).toBe("none");
    expect(applicableStyle(root, ".tube-man-position", 1280).display).toBe("none");
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
      "Mr. Nine & Lady Love",
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

  it("labels both header contact links as Contact", () => {
    const { root } = mountSite();
    const headerContactLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('.site-header a[href="#contact"]'));

    expect(headerContactLinks).toHaveLength(2);
    expect(headerContactLinks.map((link) => link.textContent?.trim().replace(/\s+/g, " "))).toEqual([
      "Contact",
      "Contact",
    ]);
  });

  it("places the flagship Adventure Zone package between the other packages", () => {
    const { root } = mountSite();
    const titles = Array.from(root.querySelectorAll<HTMLElement>(".package-card h3"), (heading) => heading.textContent?.trim());

    expect(titles).toEqual(["Pirate's Rebellion", "Adventure Zone", "Warrior's Playground"]);
  });

  it("keeps the family-owned mission inside About instead of a separate card", () => {
    const { root } = mountSite();
    const about = root.querySelector("#about");

    expect(root.querySelector("#mission")).toBeNull();
    expect(about).toHaveTextContent(
      "Family owned and operated, The Adventure Zone combines personal service with professional standards, experienced staffing, and reliable execution to help make your event safe, successful, and unforgettable.",
    );
  });

  it("keeps unopened package cards compact when one lineup opens", () => {
    const { root } = mountSite();
    const lineups = Array.from(root.querySelectorAll<HTMLDetailsElement>(".attraction-lineup"));

    lineups[1]!.open = true;

    expect(lineups.map((lineup) => lineup.open)).toEqual([false, true, false]);
    expect(applicableStyle(root, ".package-grid", 980).alignItems).toBe("start");
  });

  it("keeps crew bubbles small and the site shell full-width on mobile and desktop canvases", () => {
    const { root } = mountSite();
    const canvasWidth = 320;
    const hostStyle = applicableStyle(root, ":host", canvasWidth);
    const photoWidth = Number.parseFloat(applicableStyle(root, ".team-photo", canvasWidth).width);
    const labelWidth = Number.parseFloat(applicableStyle(root, ".team-label", canvasWidth).width);
    const toPixels = (token: string) => token.endsWith("vw")
      ? Number.parseFloat(token) * canvasWidth / 100
      : Number.parseFloat(token);
    const resolveClamp = (value: string) => {
      const parts = /^clamp\(([^,]+),\s*([^,]+),\s*([^\)]+)\)$/.exec(value);
      expect(parts, `Expected a clamp() value, received ${value}`).not.toBeNull();
      return Math.max(toPixels(parts![1]!), Math.min(toPixels(parts![2]!), toPixels(parts![3]!)));
    };
    const bubbleBounds = Array.from(root.querySelectorAll<HTMLElement>(".team-bubble")).map((bubble) => {
      const anchoredLeft = bubble.style.left !== "auto";
      const edgeOffset = resolveClamp(anchoredLeft ? bubble.style.left : bubble.style.right);
      const labelOverhang = (labelWidth - photoWidth) / 2;
      return anchoredLeft
        ? { side: "left", left: edgeOffset - labelOverhang, right: edgeOffset + photoWidth + labelOverhang }
        : { side: "right", left: canvasWidth - edgeOffset - photoWidth - labelOverhang, right: canvasWidth - edgeOffset + labelOverhang };
    });
    const leftEdgeGaps = bubbleBounds.filter(({ side }) => side === "left").map(({ left }) => Math.round(left));
    const rightEdgeGaps = bubbleBounds.filter(({ side }) => side === "right").map(({ right }) => Math.round(canvasWidth - right));
    const desktopPhotoWidth = Number.parseFloat(applicableStyle(root, ".team-photo", 1280).width);
    const desktopLabelWidth = Number.parseFloat(applicableStyle(root, ".team-label", 1280).width);

    expect(photoWidth / canvasWidth).toBeLessThanOrEqual(0.105);
    expect(labelWidth / canvasWidth).toBeLessThanOrEqual(0.225);
    expect(desktopPhotoWidth / 1280).toBeLessThanOrEqual(0.055);
    expect(desktopLabelWidth / 1280).toBeLessThanOrEqual(0.07);
    expect(bubbleBounds.every(({ left, right }) => left >= 0 && right <= canvasWidth)).toBe(true);
    expect(Math.max(...leftEdgeGaps, ...rightEdgeGaps)).toBeLessThanOrEqual(28);
    expect(new Set(leftEdgeGaps).size).toBeGreaterThanOrEqual(4);
    expect(new Set(rightEdgeGaps).size).toBeGreaterThanOrEqual(3);
    expect(hostStyle.width).toBe("100%");
    expect(hostStyle.maxWidth).toBe("100%");
    expect(hostStyle.overflowX).toBe("hidden");
  });

  it.each([320, 412, 600])("keeps the full mobile site compact at %ipx", (canvasWidth) => {
    const { root } = mountSite();
    const heroHeight = Number.parseFloat(applicableStyle(root, ".hero", canvasWidth).minHeight);
    const sectionPadding = Number.parseFloat(applicableStyle(root, ".section", canvasWidth).paddingTop);
    const statHeight = Number.parseFloat(applicableStyle(root, ".stat-card", canvasWidth).minHeight);
    const packageImageHeight = Number.parseFloat(applicableStyle(root, ".package-image", canvasWidth).height);

    expect(applicableStyle(root, ".desktop-book", canvasWidth).display).toBe("flex");
    expect(applicableStyle(root, ".hero-content", canvasWidth).alignItems).toBe("flex-start");
    expect(applicableStyle(root, ".hero-actions", canvasWidth).flexDirection).toBe("row");
    expect(applicableStyle(root, ".about-layout", canvasWidth).gridTemplateColumns).not.toBe("");
    expect(applicableStyle(root, ".experience-layout", canvasWidth).gridTemplateColumns).not.toBe("");
    expect(applicableStyle(root, ".feature-grid", canvasWidth).gridTemplateColumns).not.toBe("");
    expect(applicableStyle(root, ".how", canvasWidth).overflowX).toBe("hidden");
    expect(Number.parseFloat(applicableStyle(root, ".step-number", canvasWidth).fontSize)).toBeLessThanOrEqual(32);
    expect(heroHeight).toBeLessThanOrEqual(560);
    expect(sectionPadding).toBeLessThanOrEqual(40);
    expect(statHeight).toBeLessThanOrEqual(104);
    expect(packageImageHeight).toBeLessThanOrEqual(170);
  });

  it.each([320, 412])("keeps nested mobile card headings inside their cards at %ipx", (canvasWidth) => {
    const { root } = mountSite();

    expect(applicableStyle(root, ".how-layout", canvasWidth).gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(Number.parseFloat(applicableStyle(root, ".step-card h4", canvasWidth).fontSize)).toBeLessThanOrEqual(16);
    expect(Number.parseFloat(applicableStyle(root, ".step-card p", canvasWidth).fontSize)).toBeLessThanOrEqual(11);
    expect(Number.parseFloat(applicableStyle(root, ".scale-card h2", canvasWidth).fontSize)).toBeLessThanOrEqual(22);
    expect(applicableStyle(root, ".scale-card h2", canvasWidth).overflowWrap).toBe("anywhere");
    expect(Number.parseFloat(applicableStyle(root, ".stat-number", canvasWidth).fontSize)).toBeLessThanOrEqual(20);
    expect(applicableStyle(root, ".stat-label", canvasWidth).overflowWrap).toBe("anywhere");
  });

  it("uses a shorter mobile hero instead of zooming the background video", () => {
    const { root } = mountSite();
    const heroStyle = applicableStyle(root, ".hero", 320);
    const videoStyle = applicableStyle(root, ".hero-video", 320);
    const headingStyle = applicableStyle(root, ".hero h1", 320);

    expect(videoStyle.transform).toBe("none");
    expect(Number.parseFloat(heroStyle.minHeight)).toBeLessThanOrEqual(410);
    expect(Number.parseFloat(heroStyle.paddingTop)).toBeLessThanOrEqual(62);
    expect(Number.parseFloat(heroStyle.paddingBottom)).toBeLessThanOrEqual(18);
    expect(headingStyle.fontSize).toBe("clamp(2.35rem, 10vw, 3.5rem)");
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

  it("staggers every crew member on alternating sides throughout Wix's full page", () => {
    window.history.replaceState({}, "", "/CustomElementPreviewIframe.preview.html");
    const { root } = mountSite();
    const shell = root.querySelector<HTMLElement>(".az-site")!;
    const teamStyle = applicableStyle(root, ".team-float");
    const previewHeaderStyle = applicableStyle(root, ".az-site.wix-preview-frame .site-header .container", 980);
    const visibleBubbles = Array.from(root.querySelectorAll<HTMLElement>(".team-bubble.visible"));
    const visibleTeamIndexes = visibleBubbles.map((bubble) => bubble.dataset.teamIndex);
    const visiblePositions = visibleBubbles.map((bubble) => `${bubble.style.left}|${bubble.style.right}|${bubble.style.top}`);
    const sides = visibleBubbles.map((bubble) => bubble.style.left && bubble.style.left !== "auto" ? "left" : "right");
    const verticalPositions = visibleBubbles.map((bubble) => Number.parseFloat(bubble.style.top));

    expect(shell).toHaveClass("wix-preview-frame");
    expect(teamStyle.position).toBe("absolute");
    expect(Number.parseFloat(teamStyle.top)).toBeGreaterThanOrEqual(700);
    expect(Number.parseFloat(teamStyle.bottom)).toBeGreaterThanOrEqual(600);
    expect(teamStyle.height).toBe("");
    expect(previewHeaderStyle.width).toBe("calc(100% - 144px)");
    expect(visibleTeamIndexes).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(new Set(visiblePositions).size).toBe(11);
    expect(sides).toEqual(["left", "right", "left", "right", "left", "right", "left", "right", "left", "right", "left"]);
    expect(verticalPositions[0]).toBeLessThanOrEqual(5);
    expect(verticalPositions.at(-1)).toBeGreaterThanOrEqual(85);
    expect(verticalPositions.slice(1).every((position, index) => position - verticalPositions[index] >= 8)).toBe(true);
  });

  it("keeps every crew member document-anchored instead of recycling viewport waves", () => {
    const { root } = mountSite();
    const positionOf = (bubble: HTMLElement) => `${bubble.style.left}|${bubble.style.right}|${bubble.style.top}`;
    const positionsBeforeScroll = Array.from(root.querySelectorAll<HTMLElement>(".team-bubble"), positionOf);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    window.dispatchEvent(new Event("scroll"));
    expect(root.querySelectorAll(".team-bubble.visible")).toHaveLength(11);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 5000 });
    window.dispatchEvent(new Event("scroll"));
    const bubblesAfterScroll = Array.from(root.querySelectorAll<HTMLElement>(".team-bubble.visible"));

    expect(bubblesAfterScroll).toHaveLength(11);
    expect(bubblesAfterScroll.map(positionOf)).toEqual(positionsBeforeScroll);
  });

  it("moves a crew bubble into clear space when nearby wording changes", () => {
    const { root } = mountSite();
    const layer = root.querySelector<HTMLElement>(".team-float")!;
    const bubble = root.querySelector<HTMLElement>('.team-bubble[data-team-index="0"]')!;
    const photo = bubble.querySelector<HTMLElement>(".team-photo")!;
    const label = bubble.querySelector<HTMLElement>(".team-label")!;
    const obstacle = root.querySelector<HTMLElement>(".about h2")!;
    const details = root.querySelector<HTMLDetailsElement>(".attraction-lineup")!;
    const hiddenLineupChip = details.querySelector<HTMLElement>(".attraction-chip-list span")!;
    const layerTop = 760;
    const layerHeight = 3000;
    let obstacleTop = 790;
    const domRect = (left: number, top: number, right: number, bottom: number) => ({
      x: left,
      y: top,
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON() { return this; },
    }) as DOMRect;
    const bubbleTop = () => bubble.style.top.endsWith("%")
      ? layerHeight * Number.parseFloat(bubble.style.top) / 100
      : Number.parseFloat(bubble.style.top);

    layer.getBoundingClientRect = () => domRect(0, layerTop, 980, layerTop + layerHeight);
    Object.defineProperty(bubble, "offsetTop", { configurable: true, get: bubbleTop });
    photo.getBoundingClientRect = () => domRect(8, layerTop + bubbleTop(), 104, layerTop + bubbleTop() + 96);
    label.getBoundingClientRect = () => domRect(0, layerTop + bubbleTop() + 78, 112, layerTop + bubbleTop() + 140);
    obstacle.getBoundingClientRect = () => domRect(0, obstacleTop, 160, obstacleTop + 200);
    hiddenLineupChip.getBoundingClientRect = () => domRect(0, layerTop + 40, 160, layerTop + 180);

    window.dispatchEvent(new Event("resize"));
    const clearedTop = Number.parseFloat(bubble.style.top);

    expect(clearedTop).toBeGreaterThanOrEqual(250);

    obstacleTop = layerTop + clearedTop - 10;
    details.dispatchEvent(new Event("toggle"));

    expect(bubble.style.top).toBe("60px");

    obstacleTop = 985;
    window.dispatchEvent(new Event("resize"));
    const animationSafeTop = layerTop + Number.parseFloat(bubble.style.top);
    const animationSafeBottom = animationSafeTop + 140;
    const obstacleBottom = obstacleTop + 200;
    const verticalGap = animationSafeBottom <= obstacleTop
      ? obstacleTop - animationSafeBottom
      : animationSafeTop >= obstacleBottom
        ? animationSafeTop - obstacleBottom
        : -1;

    expect(verticalGap).toBeGreaterThanOrEqual(48);
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
    const adventureCard = cards.find((card) => card.querySelector("h3")?.textContent?.trim() === "Adventure Zone");
    expect(adventureCard?.querySelector(".package-title-copy p")).toHaveTextContent("Something for everyone.");
  });

  it("opens lineup and FAQ panels without growing beyond Wix's fixed custom-element frame", () => {
    const { root } = mountSite();
    const lineupPanel = applicableStyle(root, ".attraction-lineup-content", 320);
    const faqPanel = applicableStyle(root, ".faq-answer", 320);

    expect(lineupPanel?.position).toBe("absolute");
    expect(lineupPanel?.overflowY).toBe("auto");
    expect(faqPanel?.position).toBe("absolute");
    expect(faqPanel?.overflowY).toBe("auto");
  });

  it("explains the Adventure Zone footprint in familiar dimensions", () => {
    const { root } = mountSite();
    const faqCopy = root.querySelector("#faq")?.textContent ?? "";

    expect(faqCopy).toContain(
      "Plan for an area about 100 feet by 100 feet—roughly 10,000 square feet—for the Adventure Zone package.",
    );
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

  it("labels every navigation link to the booking card as Booking Structures", () => {
    const { root } = mountSite();
    const bookingLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href="#partnerships"]'));

    expect(bookingLinks).toHaveLength(2);
    expect(bookingLinks.every((link) => link.textContent?.includes("Booking Structures"))).toBe(true);
    expect(bookingLinks.every((link) => !link.textContent?.includes("Partnerships"))).toBe(true);
  });

  it("presents the family-owned message to large-event decision makers inside About", () => {
    const { root } = mountSite();
    const mission = root.querySelector("#about")!;

    expect(mission.querySelector("h2")?.textContent).toMatch(/Built For The\s*Big Day\./);
    expect(mission).toHaveTextContent("fairs, festivals, rodeos, and community events");
    expect(mission).toHaveTextContent("professional standards, experienced staffing, and reliable execution");
    expect(mission).toHaveTextContent(/family owned and operated/i);
    const familyParagraph = Array.from(mission.querySelectorAll("p"))
      .find((paragraph) => paragraph.textContent?.includes("Family owned and operated"));
    expect(familyParagraph?.textContent).not.toMatch(/[—–-]/);
  });

  it("keeps the Proud Members badge in the original standards row", () => {
    const { root } = mountSite();
    const stats = root.querySelector(".stats")!;
    const directStatCards = Array.from(stats.children).filter((child) => child.classList.contains("stat-card"));
    const directMemberBadge = Array.from(stats.children).find((child) => child.classList.contains("member-badge"));

    expect(directStatCards).toHaveLength(4);
    expect(directMemberBadge).toBeUndefined();
    expect(root.querySelector(".about-bottom .member-badge")).toHaveTextContent("Proud Members");
  });

  it("uses the new Pirate's Rebellion photo anywhere that package is featured", () => {
    const { root } = mountSite();
    const pirateCard = Array.from(root.querySelectorAll(".package-card"))
      .find((card) => card.querySelector("h3")?.textContent?.includes("Pirate's Rebellion"));
    const expectedUrl = "https://adventure-zone-command-center-1.onrender.com/assets/pirates-rebellion-paddle-boats.jpg";

    expect(pirateCard?.querySelector("img")).toHaveAttribute("src", expectedUrl);
  });

  it("rotates through 25 unique attraction images without using employee portraits", async () => {
    vi.useFakeTimers();
    const { element, root } = mountSite();
    const rotator = element as HTMLElement & { rotateGallery(): void };
    const gallerySources = new Set<string>();
    const employeeSources = new Set(Array.from(root.querySelectorAll<HTMLImageElement>(".team-photo"), (image) => image.src));

    for (let index = 0; index < 25; index += 1) {
      Array.from(root.querySelectorAll<HTMLImageElement>("[data-gallery-slot]"), (image) => gallerySources.add(image.src));
      rotator.rotateGallery();
      await vi.advanceTimersByTimeAsync(121);
    }

    expect(gallerySources.size).toBe(25);
    expect(Array.from(gallerySources).every((url) => !employeeSources.has(url))).toBe(true);
  });

  it.each([
    "pirates-rebellion-paddle-boats.jpg",
    "gallery-family-play-zone.jpg",
    "gallery-adventure-rules.jpg",
    "gallery-purple-obstacle-course.jpg",
    "gallery-pirate-flag.jpg",
    "gallery-red-yellow-obstacle-slide.jpg",
    "gallery-wrecking-ball-obstacle.jpg",
    "gallery-action-arena.jpg",
    "gallery-rainbow-slide.jpg",
    "gallery-bungee-run.jpg",
  ])("ships the added attraction photo %s", (filename) => {
    const path = `public/assets/${filename}`;

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it("slightly enlarges Spectacle cards by tightening responsive grid gaps", () => {
    const { root } = mountSite();

    expect(Number.parseFloat(applicableStyle(root, ".gallery-grid", 320).gap)).toBeLessThanOrEqual(8);
    expect(Number.parseFloat(applicableStyle(root, ".gallery-grid", 980).gap)).toBeLessThanOrEqual(24);
  });

  it("highlights Pay-For-Play as a fundraising opportunity", () => {
    const { root } = mountSite();
    const payForPlayCard = Array.from(root.querySelectorAll(".booking-card"))
      .find((card) => card.querySelector("h3")?.textContent?.includes("Pay-For-Play"));

    expect(payForPlayCard?.querySelector(".fundraising-highlight"))
      .toHaveTextContent("A Fun Fundraising Opportunity");
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
    const { root } = mountSite();
    const canvasWidth = 980;
    const finalStyle = (selector: string, property: keyof CSSStyleDeclaration) => {
      return applicableStyle(root, selector, canvasWidth)[property] as string | undefined;
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
    expect(resolveClamp(finalStyle(".hero", "minHeight"))).toBeLessThanOrEqual(580);
    expect(finalStyle(".desktop-nav", "display")).toBe("none");
  });

  it("opens a requested homepage section from the legacy redirect query", async () => {
    window.history.replaceState({}, "", "/?section=packages");
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    mountSite();
    await flush();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("keeps the rotated promo banner below the fixed header on Wix's desktop canvas", () => {
    const { root } = mountSite();
    const canvasWidth = 980;
    const padding = applicableStyle(root, ".hero", canvasWidth).padding.split(/\s+/).map(Number.parseFloat);
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

  it("shows the approved welcome only for the exact convention query", () => {
    window.history.replaceState({}, "", "/?welcome=convention");
    const { root } = mountSite();
    const welcome = root.querySelector<HTMLElement>(".convention-welcome");
    const dialog = welcome?.querySelector<HTMLElement>(".convention-dialog");

    expect(welcome).not.toHaveAttribute("hidden");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "convention-welcome-title");
    expect(dialog).toHaveTextContent("CONVENTION EXCLUSIVE");
    expect(dialog).toHaveTextContent("So Many Fun Things to Offer");
    expect(dialog).toHaveTextContent("Which package would you like to see first?");
    expect(dialog).not.toHaveTextContent(/tell us about your event/i);
    expect(dialog).not.toHaveTextContent(/fill out|contact form/i);
    expect(Array.from(root.querySelectorAll("[data-convention-package]")).map((button) => button.textContent?.trim())).toEqual([
      "Adventure Zone",
      "Weekend Warriors",
      "Pirates Rebellion",
    ]);
    expect(root.querySelector(".convention-form-note")).toHaveAttribute("hidden");
    expect(dialog?.textContent).not.toMatch(/12%|7 days|15 days/i);
    expect(root.querySelector("[data-convention-close]")).toHaveAttribute("aria-label", "Close convention welcome");
    expect(root.activeElement).toBe(dialog);
  });

  it.each(["/", "/?welcome=Convention", "/?welcome=conventions", "/?section=contact"])(
    "does not show the convention welcome for %s",
    (url) => {
      window.history.replaceState({}, "", url);
      const { root } = mountSite();

      expect(root.querySelector(".convention-welcome")).toHaveAttribute("hidden");
      expect(root.querySelector(".convention-form-note")).toHaveAttribute("hidden");
      expect(document.body.style.overflow).toBe("");
    },
  );

  it.each([
    ["Adventure Zone", "Adventure Zone"],
    ["Weekend Warriors", "Warrior's Playground"],
    ["Pirates Rebellion", "Pirate's Rebellion"],
  ])("closes the welcome and shows the selected %s package first", (choice, packageTitle) => {
    window.history.replaceState({}, "", "/?welcome=convention");
    const { root } = mountSite();
    const card = Array.from(root.querySelectorAll<HTMLElement>(".package-card"))
      .find((item) => item.querySelector("h3")?.textContent?.trim() === packageTitle)!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(card, "scrollIntoView", { configurable: true, value: scrollIntoView });

    root.querySelector<HTMLButtonElement>(`[data-convention-package="${choice}"]`)!.click();

    expect(root.querySelector(".convention-welcome")).toHaveAttribute("hidden");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.body.style.overflow).toBe("");
  });

  it.each(["[data-convention-close]", "[data-convention-backdrop]"])(
    "dismisses without scrolling from %s",
    (selector) => {
      window.history.replaceState({}, "", "/?welcome=convention");
      const scrollIntoView = vi.fn();
      Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
      const { root } = mountSite();

      root.querySelector<HTMLButtonElement>(selector)!.click();

      expect(root.querySelector(".convention-welcome")).toHaveAttribute("hidden");
      expect(scrollIntoView).not.toHaveBeenCalled();
    },
  );

  it("dismisses on Escape and keeps Tab focus inside the dialog", () => {
    window.history.replaceState({}, "", "/?welcome=convention");
    const { root } = mountSite();
    const firstPackage = root.querySelector<HTMLButtonElement>('[data-convention-package="Adventure Zone"]')!;
    const close = root.querySelector<HTMLButtonElement>("[data-convention-close]")!;

    close.focus();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(root.activeElement).toBe(firstPackage);

    firstPackage.focus();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(root.activeElement).toBe(close);

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector(".convention-welcome")).toHaveAttribute("hidden");
  });

  it("locks background scroll, restores it on disconnect, and fits narrow screens", () => {
    window.history.replaceState({}, "", "/?welcome=convention");
    const { element, root } = mountSite();

    expect(document.body.style.overflow).toBe("hidden");
    const dialogWidth = applicableStyle(root, ".convention-dialog", 320).width;
    expect(dialogWidth).toContain("min(560px");
    expect(dialogWidth).toContain("100vw");
    expect(dialogWidth).toContain("32px");
    expect(applicableStyle(root, ".convention-actions", 320).gridTemplateColumns).toBe("minmax(0, 1fr)");

    element.remove();
    expect(document.body.style.overflow).toBe("");
  });

  it("marks a convention QR inquiry in the existing message payload", async () => {
    window.history.replaceState({}, "", "/?welcome=convention");
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => "10000000-0000-4000-8000-000000000000",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ referenceCode: "AZI-CONVENTION", message: "Saved." }), { status: 201, headers: { "Content-Type": "application/json" } }));
    const { form } = mountForm();

    submit(form);
    await flush();

    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]![1]!.body));
    expect(body.message).toBe("Please bring the full Adventure Zone.\n\nLead source: Convention QR");
    expect(body.pageUrl).toContain("welcome=convention");
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
