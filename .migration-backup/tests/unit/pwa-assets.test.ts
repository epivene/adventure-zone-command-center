import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

function pngDimensions(path: string) {
  const png = readFileSync(path);
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe("installable app assets", () => {
  it("opens the installed app on Today in standalone mode", () => {
    expect(manifest()).toMatchObject({
      name: "Adventure Zone Command Center",
      short_name: "AZ Command",
      start_url: "/today",
      display: "standalone",
    });
  });

  it("provides valid PNG icons at the declared sizes", () => {
    expect(pngDimensions("public/icons/icon-192.png")).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngDimensions("public/icons/icon-512.png")).toEqual({
      width: 512,
      height: 512,
    });
  });
});
