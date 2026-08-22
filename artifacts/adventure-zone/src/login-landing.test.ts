import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("public/login-screen.css", "utf8");

describe("public login landing", () => {
  it("uses the supplied Adventure Zone artwork as the real full-screen background", () => {
    expect(existsSync("public/adventure-zone-login-background.jpg")).toBe(true);
    expect(css).toContain('url("/adventure-zone-login-background.jpg")');
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
