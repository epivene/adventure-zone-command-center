import packageJson from "@/package.json";
import { describe, expect, it } from "vitest";

import { initialTravelLegs } from "@/db/seed";

describe("database seed runner contract", () => {
  it("provides a supported TypeScript seed command for the four default legs", () => {
    expect(packageJson.scripts["db:seed"]).toBe("node --import tsx db/seed.ts");
    expect(initialTravelLegs).toEqual([
      { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
      { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
      { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
      { name: "Leg 4", color: "#15956B", sortOrder: 4 },
    ]);
  });
});
