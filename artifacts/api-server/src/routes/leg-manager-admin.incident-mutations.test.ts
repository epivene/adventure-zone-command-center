import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync("src/routes/leg-manager-admin.ts", "utf8");
const repository = readFileSync("src/features/leg-manager/incident-repository.ts", "utf8");
const storage = readFileSync("src/features/leg-manager/leg-manager-object-storage.ts", "utf8");

describe("admin incident mutations", () => {
  it("supports editing incidents from the owner admin API", () => {
    expect(routes).toContain('router.patch("/manager-admin/incidents/:incidentId"');
    expect(repository).toContain("updateIncident(");
  });

  it("supports deleting incidents and stored incident photos", () => {
    expect(routes).toContain('router.delete("/manager-admin/incidents/:incidentId"');
    expect(repository).toContain("deleteIncident(");
    expect(storage).toContain("delete(key:string)");
  });
});
