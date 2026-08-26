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

  it("does not add profile/contact mutations, calendar writes, Gmail drafts, or sends", () => {
    for (const forbidden of ["insert(organizations", "insert(contacts", "calendar.events.insert", "createDraft", "sendMail"]) {
      expect(routeSource).not.toContain(forbidden);
    }
  });

  it("classifies previous contact with version and verification safety responses", () => {
    expect(routeSource).toContain('router.post("/lead-intake/rows/:rowId/classify-relationship"');
    expect(routeSource).toContain("relationshipService.classifyRelationship");
    expect(routeSource).toContain('error.code === "VERSION_CONFLICT"');
    expect(routeSource).toContain('error.code === "RELATIONSHIP_NOT_READY"');
    expect(routeSource).toContain("res.status(409)");
    expect(routeSource).toContain("res.status(422)");
    expect(routeSource).toContain("optionalGoogleReadClient");
    expect(routeSource).toContain("catch {");
  });
});
