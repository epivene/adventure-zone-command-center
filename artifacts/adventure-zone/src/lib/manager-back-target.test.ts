import { describe, expect, it } from "vitest";
import { managerBackTarget } from "./manager-back-target";

describe("managerBackTarget", () => {
  it("returns crew for worker detail pages", () => {
    expect(managerBackTarget("/manager/crew/worker-1")).toBe("/manager/crew");
  });

  it("returns incidents for the new incident page", () => {
    expect(managerBackTarget("/manager/incidents/new")).toBe("/manager/incidents");
  });

  it("returns manager home for top-level manager sections", () => {
    expect(managerBackTarget("/manager/crew")).toBe("/manager");
    expect(managerBackTarget("/manager/money")).toBe("/manager");
  });

  it("does not show a back target on manager home", () => {
    expect(managerBackTarget("/manager")).toBeNull();
  });
});
