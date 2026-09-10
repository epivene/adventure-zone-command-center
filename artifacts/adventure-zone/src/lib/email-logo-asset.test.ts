import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { URL } from "node:url";
import { expect, it } from "vitest";

it("ships every scanline of the transparent email logo, not a truncated upload", () => {
  const png = readFileSync(new URL("../../public/assets/adventure-zone-logo-tagline-20260910.png", import.meta.url));
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8); // 8-bit channels
  expect(png[25]).toBe(6); // RGBA, preserving transparency
  expect(png[28]).toBe(0); // Non-interlaced scanlines
  const data: Buffer[] = [];
  let ended = false;
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    expect(offset + size + 12, "PNG chunk must be complete").toBeLessThanOrEqual(png.length);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
    if (type === "IEND") { ended = true; expect(offset).toBe(png.length); break; }
  }
  expect(ended, "PNG must include its final chunk").toBe(true);
  expect(inflateSync(Buffer.concat(data)).length).toBe(height * (width * 4 + 1));
});
