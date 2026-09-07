import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../public/adventure-zone-site-20260904-foldable-mascot-v33.js",
    import.meta.url,
  ),
  "utf8",
);

test("renders every Spectacle image in a horizontally scrollable gallery", () => {
  assert.match(source, /return galleryImages\.map\(/);
  assert.match(source, /class="gallery-controls"/);
  assert.match(source, /class="gallery-arrow gallery-prev"/);
  assert.match(source, /class="gallery-arrow gallery-next"/);
  assert.match(source, /overflow-x:\s*auto/);
  assert.match(source, /scroll-snap-type:\s*x mandatory/);
});

test("auto-advances the gallery every ten seconds without blocking manual controls", () => {
  assert.match(source, /const GALLERY_AUTOPLAY_MS = 10000/);
  assert.match(source, /scrollGallery\(direction/);
  assert.match(source, /scheduleGalleryAutoplay\(/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(source, /addEventListener\("wheel"/);
});
