import { describe, expect, it } from "vitest";

import { getPackageInventoryPolicy } from "./package-policy";

describe("package inventory policy", () => {
  it("sets the reviewed normal capacities and keeps approval-only options separate", () => {
    expect(getPackageInventoryPolicy()).toEqual({
      adventure_zone: { normalCapacity: 5, restrictedOptions: [] },
      pirates_rebellion: {
        normalCapacity: 3,
        restrictedOptions: [{
          key: "pirates_rebellion_restricted_fourth_unit",
          approvalRequired: true,
          reason: "Massive pool; requires extremely flat ground.",
        }],
      },
      warriors_playground: { normalCapacity: 1, restrictedOptions: [] },
      mini_zone: {
        normalCapacity: 0,
        restrictedOptions: [{
          key: "mini_zone",
          approvalRequired: true,
          reason: "Last-resort / Dave approval only; estimated $5,000–$6,000 with final price set by Dave.",
        }],
      },
    });
  });
});
