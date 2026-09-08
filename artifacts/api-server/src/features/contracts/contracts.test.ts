import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { readAdobeSignConfig } from "./adobe-sign-config";
import { renderContractPdf } from "./contract-pdf";

describe("Acrobat Sign contract boundary", () => {
  it("keeps drafting available while reporting missing Render Sign API configuration", () => {
    const config = readAdobeSignConfig({});
    expect(config.readiness.draftingAvailable).toBe(true);
    expect(config.readiness.signApiAvailable).toBe(false);
    expect(config.readiness.missing).toContain("ADOBE_SIGN_REFRESH_TOKEN");
  });

  it("reports ready only when every server-side credential and recipient setting is present", () => {
    const config = readAdobeSignConfig({
      ADOBE_SIGN_API_BASE_URL: "https://api.example.test/api/rest/v6",
      ADOBE_SIGN_CLIENT_ID: "client",
      ADOBE_SIGN_CLIENT_SECRET: "secret",
      ADOBE_SIGN_REFRESH_TOKEN: "refresh",
      ADOBE_SIGN_ACCOUNT_ID: "account",
      ADOBE_SIGN_DAVID_EMAIL: "david@example.test",
      ADOBE_SIGN_WEBHOOK_SECRET: "webhook",
    });
    expect(config.readiness.signApiAvailable).toBe(true);
    expect(config.readiness.missing).toEqual([]);
  });

  it("renders a stable immutable PDF payload", () => {
    const pdf = renderContractPdf({
      title: "Festival Agreement",
      organizationName: "Sample Festival",
      customerName: "Casey Customer",
      customerEmail: "casey@example.test",
      bookingName: "2027 Festival",
      content: "<p>Reviewed terms</p>",
    });
    expect(new TextDecoder().decode(pdf)).toMatch(/^%PDF-1.4/);
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("orders the customer before David and disables local signature simulation", async () => {
    const [client, routes] = await Promise.all([
      readFile(new URL("./adobe-sign-client.ts", import.meta.url), "utf8"),
      readFile(new URL("../../routes/office-contracts.ts", import.meta.url), "utf8"),
    ]);
    expect(client.indexOf("order: 1")).toBeLessThan(client.indexOf("order: 2"));
    expect(routes).toContain("Signatures must be completed and confirmed through Acrobat Sign.");
    expect(routes).toContain("onConflictDoNothing()");
  });
});