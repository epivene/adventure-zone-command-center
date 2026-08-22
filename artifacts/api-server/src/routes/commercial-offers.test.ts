import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(path.resolve(process.cwd(), "src/routes/commercial-offers.ts"), "utf8");
const settings = readFileSync(path.resolve(process.cwd(), "src/routes/settings.ts"), "utf8");
const index = readFileSync(path.resolve(process.cwd(), "src/routes/index.ts"), "utf8");

describe("commercial offer route boundary", () => {
  it("uses explicit activate/archive actions instead of state changes through ordinary edits", () => {
    expect(route).toContain('/commercial-offers/:offerId/activate');
    expect(route).toContain('/commercial-offers/:offerId/archive');
    expect(route).toContain('state: existing.state');
    expect(route).toContain('state: "proposed"');
  });

  it("is mounted through the owner-only settings router", () => {
    expect(settings).toContain("commercialOffersRouter");
    expect(settings).toContain("router.use(commercialOffersRouter)");
    expect(index.indexOf("router.use(settingsRouter)")).toBeGreaterThan(
      index.indexOf("router.use(requireOwnerMiddleware)"),
    );
  });

  it("returns activation conflicts as a deliberate 409", () => {
    expect(route).toContain("validateOfferActivation");
    expect(route).toContain("status(409)");
  });
});
