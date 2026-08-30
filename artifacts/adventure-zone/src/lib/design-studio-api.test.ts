// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assetImageUrl,
  isImageAsset,
  isStableImageUrl,
  resolveImageSrc,
  type DesignAsset,
} from "./design-studio-api";

function asset(overrides: Partial<DesignAsset> = {}): DesignAsset {
  return {
    id: "a1",
    name: "photo.jpg",
    scope: "company",
    mimeType: "image/jpeg",
    altText: "A photo",
    storageKey: "keys/photo.jpg",
    url: null,
    ...overrides,
  };
}

describe("isImageAsset", () => {
  it("accepts image mime types and image extensions", () => {
    expect(isImageAsset(asset({ mimeType: "image/png" }))).toBe(true);
    expect(isImageAsset(asset({ mimeType: null, name: "logo.SVG" }))).toBe(true);
    expect(isImageAsset(asset({ mimeType: "application/pdf", name: "x.pdf" }))).toBe(false);
  });
});

describe("isStableImageUrl", () => {
  it("rejects null/empty", () => {
    expect(isStableImageUrl(null)).toBe(false);
    expect(isStableImageUrl("")).toBe(false);
  });

  it("rejects signed object-storage URLs (expiring)", () => {
    expect(
      isStableImageUrl("https://storage.example.com/o/file?X-Goog-Signature=abc&X-Goog-Expires=900"),
    ).toBe(false);
    expect(
      isStableImageUrl("https://s3.amazonaws.com/b/k?X-Amz-Signature=xyz&X-Amz-Expires=3600"),
    ).toBe(false);
    expect(isStableImageUrl("https://cdn.example.com/x.jpg?token=deadbeef")).toBe(false);
    expect(isStableImageUrl("https://cdn.example.com/x.jpg?expires=123&sig=zzz")).toBe(false);
  });

  it("accepts stable http(s), relative, and data URLs", () => {
    expect(isStableImageUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isStableImageUrl("/assets/logo.png")).toBe(true);
    expect(isStableImageUrl("data:image/png;base64,AAAA")).toBe(true);
  });
});

describe("resolveImageSrc – never trusts stale/signed src persisted on the node", () => {
  it("re-resolves a Studio asset from the current asset list at render time", () => {
    // Node persisted only assetId (no signed URL baked in).
    const node = { assetId: "a1", src: null };
    const fresh = asset({ id: "a1", url: "https://storage/o/a1?X-Goog-Signature=fresh" });
    expect(resolveImageSrc(node, [fresh])).toBe(
      "https://storage/o/a1?X-Goog-Signature=fresh",
    );
  });

  it("prefers the freshly loaded asset URL over any src stored on the node", () => {
    // Even if an old signed URL leaked into src, the loaded asset wins.
    const node = { assetId: "a1", src: "https://storage/o/a1?X-Goog-Signature=STALE" };
    const fresh = asset({ id: "a1", url: "https://storage/o/a1?X-Goog-Signature=NEW" });
    expect(resolveImageSrc(node, [fresh])).toBe(
      "https://storage/o/a1?X-Goog-Signature=NEW",
    );
  });

  it("returns null for an asset that is no longer available and has no stable src", () => {
    const node = { assetId: "gone", src: "https://storage/o/x?X-Goog-Signature=STALE" };
    expect(resolveImageSrc(node, [])).toBeNull();
  });

  it("falls back to a genuinely stable src when the asset is missing", () => {
    const node = { assetId: "gone", src: "https://cdn.example.com/logo.png" };
    expect(resolveImageSrc(node, [])).toBe("https://cdn.example.com/logo.png");
  });

  it("uses a stable external src when there is no assetId", () => {
    const node = { assetId: null, src: "https://cdn.example.com/hero.jpg" };
    expect(resolveImageSrc(node, [])).toBe("https://cdn.example.com/hero.jpg");
  });

  it("ignores a signed src when there is no assetId", () => {
    const node = { assetId: null, src: "https://storage/o/x?X-Amz-Signature=STALE" };
    expect(resolveImageSrc(node, [])).toBeNull();
  });
});

describe("assetImageUrl", () => {
  it("returns the explicit url or null", () => {
    expect(assetImageUrl(asset({ url: "https://x/y.png" }))).toBe("https://x/y.png");
    expect(assetImageUrl(asset({ url: null }))).toBeNull();
  });
});
