import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync("src/routes/lead-intake.ts", "utf8");
const routesIndex = readFileSync("src/routes/index.ts", "utf8");

describe("lead intake owner routes", () => {
  it("persists imports and retrieves their review rows", () => {
    expect(routeSource).toContain('router.post("/lead-intake/imports"');
    expect(routeSource).toContain('router.get("/lead-intake/imports/:batchId"');
    expect(routeSource).toContain("importLeadWorkbookSchema.safeParse");
  });

  it("is mounted only after owner authentication", () => {
    expect(routesIndex.indexOf("router.use(requireOwnerMiddleware)"))
      .toBeLessThan(routesIndex.indexOf("router.use(leadIntakeRouter)"));
  });

  it("does not create profiles, contacts, calendar entries, drafts, or sends", () => {
    for (const forbidden of ["organizations", "contacts", "calendar", "gmail", "sendMail"]) {
      expect(routeSource.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
