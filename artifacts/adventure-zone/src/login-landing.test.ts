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

  it("makes Office Coordinator the primary landing action", () => {
    expect(app).toContain('className="button-primary px-6 py-3 text-center" href="/office/sign-in">Office Coordinator');
  });

  it("renames the manager entrance to Leg Managers", () => {
    expect(app).toContain('href="/manager/sign-in">Leg Managers');
    expect(app).not.toContain('href="/manager/sign-in">Manager Portal');
  });

  it("moves administrator access out of the main button stack", () => {
    expect(app).toContain('aria-label="Administrator Access"');
    expect(app).toContain('title="Administrator Access"');
    expect(app).toContain('href="/sign-in"');
    expect(app).not.toContain('href="/sign-in">Admin / Command Center');
  });
});
