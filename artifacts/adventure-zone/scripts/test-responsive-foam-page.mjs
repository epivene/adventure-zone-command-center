import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(
  new URL("../public/adventure-zone-site-20260921-responsive-foam.js", import.meta.url),
  "utf8",
);

function mount(path, tag = "adventure-zone-package", packageKey = "") {
  const dom = new JSDOM("<body></body>", {
    url: `https://www.the-adventure-zone.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  window.matchMedia = () => ({ matches: true });
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
    /@media\s*\(max-width:\s*767px\)[\s\S]*?\.package-page[\s\S]*?max-width:\s*none[\s\S]*?width:\s*100%[\s\S]*?margin:\s*0/,
  );
});
