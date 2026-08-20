import { describe, expect, it } from "vitest";

import { preparePaperNoteImage } from "./paper-note-image";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe("preparePaperNoteImage", () => {
  it("detects PNG by bytes and returns its dimensions and hash", async () => {
    const result = await preparePaperNoteImage({
      bytes: png(1200, 800),
      declaredMimeType: "image/png",
    });
    expect(result.detectedMimeType).toBe("image/png");
    expect(result.width).toBe(1200);
    expect(result.height).toBe(800);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a declared/detected MIME mismatch", async () => {
    await expect(preparePaperNoteImage({
      bytes: png(100, 100),
      declaredMimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "IMAGE_TYPE_MISMATCH" });
  });

  it("rejects unsupported or empty bytes", async () => {
    await expect(preparePaperNoteImage({
      bytes: new Uint8Array(),
      declaredMimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });
});
