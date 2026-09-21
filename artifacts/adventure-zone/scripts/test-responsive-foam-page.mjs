import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(
  new URL("../public/adventure-zone-site-20260921-responsive-foam.js", import.meta.url),
  "utf8",
);
const homeSource = readFileSync(
  new URL("../public/adventure-zone-site-20260921-responsive-home.js", import.meta.url),
  "utf8",
);

function mount(path, tag = "adventure-zone-package", packageKey = "", reducedMotion = false) {
  const dom = new JSDOM("<body></body>", {
    url: `https://www.the-adventure-zone.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  window.matchMedia = () => ({ matches: reducedMotion });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(source);
  const element = window.document.createElement(tag);
  if (packageKey) element.setAttribute("package-key", packageKey);
  window.document.body.append(element);
  return { dom, element, root: element.shadowRoot };
}

test("Foam Party page begins with a five-photo rotating gallery", () => {
  const page = mount("/foam-party-add-on", "adventure-zone-package", "foam-party");
  try {
    const gallery = page.root.querySelector(".foam-gallery");
    assert.ok(gallery);
    assert.equal(gallery.querySelectorAll(".foam-gallery-slide").length, 5);
    assert.ok(gallery.querySelector(".foam-gallery-slide.active"));
    assert.ok(gallery.compareDocumentPosition(page.root.querySelector("#package-detail-title")) & 4);
  } finally {
    page.dom.window.close();
  }
});

test("Foam Party gallery advances and wraps", () => {
  const page = mount("/foam-party-add-on", "adventure-zone-package", "foam-party");
  try {
    const slides = page.root.querySelectorAll(".foam-gallery-slide");
    page.element.rotateFoamGallery();
    assert.equal(slides[1].classList.contains("active"), true);
    for (let index = 0; index < 4; index += 1) page.element.rotateFoamGallery();
    assert.equal(slides[0].classList.contains("active"), true);
  } finally {
    page.dom.window.close();
  }
});

test("mobile package surfaces explicitly remove desktop width caps and gutters", () => {
  assert.match(
    source,
    /@media\s*\(max-width:\s*767px\)[\s\S]*?:host[\s\S]*?width:\s*100vw\s*!important[\s\S]*?margin-left:\s*calc\(\(100%\s*-\s*100vw\)\s*\/\s*2\)[\s\S]*?\.package-page[\s\S]*?max-width:\s*none/,
  );
});


test("mobile homepage surface explicitly removes inherited width caps", () => {
  assert.match(
    homeSource,
    /@media\s*\(max-width:\s*767px\)[\s\S]*?:host[\s\S]*?width:\s*100vw\s*!important[\s\S]*?margin-left:\s*calc\(\(100%\s*-\s*100vw\)\s*\/\s*2\)[\s\S]*?\.az-site[\s\S]*?max-width:\s*none/,
  );
});

test("existing standalone packages keep their media-first details", () => {
  for (const [path, key, title] of [
    ["/adventure-zone-package", "adventure-zone", "Adventure Zone"],
    ["/pirates-rebellion-package", "pirates-rebellion", "Pirate's Rebellion"],
    ["/warriors-playground-package", "weekend-warriors", "Warrior's Playground"],
  ]) {
    const page = mount(path, "adventure-zone-package", key);
    try {
      assert.equal(page.root.querySelector("h1").textContent, title);
      assert.ok(page.root.querySelector(".package-video video"));
      assert.ok(
        page.root
          .querySelector(".package-video")
          .compareDocumentPosition(page.root.querySelector("#package-detail-title")) & 4,
      );
    } finally {
      page.dom.window.close();
    }
  }
});


test("Foam Party gallery gives visitors a pause and play control", () => {
  const page = mount("/foam-party-add-on", "adventure-zone-package", "foam-party");
  try {
    const control = page.root.querySelector("[data-foam-gallery-toggle]");
    assert.ok(control);
    assert.equal(control.getAttribute("aria-pressed"), "false");
    assert.match(control.textContent, /pause/i);
    control.click();
    assert.equal(control.getAttribute("aria-pressed"), "true");
    assert.match(control.textContent, /play/i);
    control.click();
    assert.equal(control.getAttribute("aria-pressed"), "false");
  } finally {
    page.dom.window.close();
  }
});


test("reduced-motion visitors can explicitly start the gallery", () => {
  const page = mount("/foam-party-add-on", "adventure-zone-package", "foam-party", true);
  try {
    const control = page.root.querySelector("[data-foam-gallery-toggle]");
    assert.equal(control.getAttribute("aria-pressed"), "true");
    assert.match(control.textContent, /play/i);
    control.click();
    assert.equal(control.getAttribute("aria-pressed"), "false");
    assert.match(control.textContent, /pause/i);
  } finally {
    page.dom.window.close();
  }
});
