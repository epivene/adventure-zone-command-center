import { describe, expect, it } from "vitest";

import { decideImportedFollowUpAction } from "./imported-follow-up-policy";

describe("decideImportedFollowUpAction", () => {
  it("reuses the exact imported task without replacing a later human task", () => {
    expect(decideImportedFollowUpAction({
      preserveExisting: true,
      exactOpenId: "imported-task",
      openIds: ["imported-task"],
    })).toEqual({ action: "reuse_exact", followUpId: "imported-task" });
  });

  it("preserves an existing open task instead of restoring the batch task", () => {
    expect(decideImportedFollowUpAction({
      preserveExisting: true,
      exactOpenId: null,
      openIds: ["human-task"],
    })).toEqual({ action: "preserve_open", followUpId: "human-task" });
  });

  it("creates the imported task when the profile has no open follow-up", () => {
    expect(decideImportedFollowUpAction({
      preserveExisting: true,
      exactOpenId: null,
      openIds: [],
    })).toEqual({ action: "create" });
  });

  it("retains the normal replacement policy outside approved-profile imports", () => {
    expect(decideImportedFollowUpAction({
      preserveExisting: false,
      exactOpenId: null,
      openIds: ["old-task"],
    })).toEqual({ action: "replace_and_create" });
  });
});
