import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("public/login-screen.css", "utf8");

describe("public login landing", () => {
  it("uses a real supplied Adventure Zone WebP as the full-screen background", () => {
    const assetPath = "public/adventure-zone-login-background.webp";
    expect(existsSync(assetPath)).toBe(true);

    const asset = readFileSync(assetPath);
    expect(asset.length).toBeGreaterThan(40_000);
    expect(asset.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(asset.subarray(8, 12).toString("ascii")).toBe("WEBP");

    expect(css).toContain('url("/adventure-zone-login-background.webp")');
    expect(css).toContain("background-size: cover");
    expect(css).toContain("background-position: center top");
  });

  it("keeps the three live role links styled like the approved reference", () => {
    expect(css).toContain('a[href="/office/sign-in"]');
    expect(css).toContain('a[href="/manager/sign-in"]');
    expect(css).toContain('a[href="/sign-in"]');
    expect(css).toContain("Office Coordinator");
    expect(css).toContain("Mailing, outreach & follow-up");
    expect(css).toContain("Leg Managers");
    expect(css).toContain("Routes, bookings & events");
    expect(css).toContain("Administrator Access");
    expect(css).toContain("System settings & advanced tools");
  });

  it("does not redraw the logo and welcome copy over artwork that already contains them", () => {
    expect(css).toContain("> h1,\n#root > div:has(a[href=\"/office/sign-in\"]) > p");
    expect(css).toContain("display: none !important");
  });
});
