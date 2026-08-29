import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const index = readFileSync("index.html", "utf8");
const landing = readFileSync("src/components/command-terminal/command-terminal-landing.tsx", "utf8");

describe("public login landing", () => {
  it("uses the app's normal styling instead of a special login stylesheet", () => {
    expect(index).not.toContain('href="/login-screen.css"');
    expect(existsSync("public/login-screen.css")).toBe(false);
    expect(existsSync("public/adventure-zone-login-background.webp")).toBe(false);
  });

  it("uses the focused workspace landing copy", () => {
    expect(landing).not.toContain("Start with the workspace that matches your day.");
    expect(landing).not.toContain("Bookings, contacts, routes, and calls for your adventure business — all in one place.");
  });

  it("makes Office Coordinator the primary landing action", () => {
    expect(landing).toContain('href="/office/sign-in"');
    expect(landing).toContain("Office Coordinator");
  });

  it("renames the manager entrance to Leg Managers", () => {
    expect(landing).toContain('href="/manager/sign-in"');
    expect(landing).toContain("Leg Managers");
    expect(landing).not.toContain("Manager Portal");
  });

  it("does not duplicate workspace actions with a focus card", () => {
    expect(landing).not.toContain("Today’s focus");
    expect(landing).not.toContain("Continue to Office");
  });

  it("moves administrator access out of the main button stack", () => {
    expect(landing).toContain('aria-label="Administrator Access"');
    expect(landing).toContain('title="Administrator Access"');
    expect(landing).toContain('href="/sign-in"');
    expect(landing).not.toContain('href="/sign-in">Admin / Command Center');
  });
});
