import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ManagerAftermathAdminPage.tsx", "utf8");

describe("admin incident actions", () => {
  it("offers edit and delete controls for incidents", () => {
    expect(source).toContain(">Edit<");
    expect(source).toContain(">Delete<");
    expect(source).toContain("/manager-admin/incidents/${incident.id}");
  });
});
