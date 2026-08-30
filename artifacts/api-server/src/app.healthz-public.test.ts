import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/app.ts", "utf8");
const fillerSource = readFileSync("src/routes/organization-filler.ts", "utf8");

describe("Render health check routing", () => {
  it("does not put owner auth in front of every /api route", () => {
    expect(appSource).toContain('app.use("/api", organizationFillerRouter);');
    expect(appSource).not.toContain('app.use("/api", requireOwnerMiddleware, organizationFillerRouter);');
  });

  it("keeps organization filler endpoints owner-protected", () => {
    expect(fillerSource).toContain('router.get("/organizations/filler", requireOwnerMiddleware');
    expect(fillerSource).toContain('router.post("/organizations/filler", requireOwnerMiddleware');
  });
});
