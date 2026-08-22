import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const index = readFileSync("index.html", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("public login landing", () => {
  it("uses the app's normal styling instead of a special login stylesheet", () => {
    expect(index).not.toContain('href="/login-screen.css"');
    expect(existsSync("public/login-screen.css")).toBe(false);
    expect(existsSync("public/adventure-zone-login-background.webp")).toBe(false);
  });

  it("keeps the three live workspace routes", () => {
    expect(app).toContain('href="/sign-in">Admin / Command Center');
    expect(app).toContain('href="/office/sign-in">Office Coordinator');
    expect(app).toContain('href="/manager/sign-in">Manager Portal');
  });
});
