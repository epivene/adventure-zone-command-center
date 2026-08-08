import { describe, expect, it } from "vitest";

import { manualResumeCheckpointStates } from "./checkpoint-repository";

describe("manual Act extraction resume", () => {
  it("requeues every leased checkpoint when the owner explicitly resumes", () => {
    expect(manualResumeCheckpointStates).toContain("leased");
  });
});
