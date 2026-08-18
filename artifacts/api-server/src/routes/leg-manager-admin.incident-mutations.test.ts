import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/routes/leg-manager-admin.ts", "utf8");
const repository = readFileSync("src/features/leg-manager/incident-repository.ts", "utf8");
const storage = readFileSync("src/features/leg-manager/leg-manager-object-storage.ts", "utf8");

describe("admin incident mutations", () => {
  it("supports editing incidents through the admin route", () => {
    expect(route).toContain('router.patch("/manager-admin/incidents/:incidentId"');
    expect(route).toContain("incidents.updateIncident");
    expect(repository).toContain("updateIncident(");
  });

  it("supports deleting incidents and their stored attachments", () => {
    expect(route).toContain('router.delete("/manager-admin/incidents/:incidentId"');
    expect(route).toContain("incidents.deleteIncident");
    expect(repository).toContain("deleteIncident(");
    expect(storage).toMatch(/delete\(key:\s*string\)/);
  });
});
