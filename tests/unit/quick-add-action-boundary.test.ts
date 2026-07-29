import { describe, expect, it } from "vitest";

import * as quickAddActions from "@/app/(private)/quick-add/actions";

describe("Quick Add action boundary", () => {
  it("exports only the owner-gated server action", () => {
    expect(Object.keys(quickAddActions)).toEqual(["createQuickCallerAction"]);
  });
});
