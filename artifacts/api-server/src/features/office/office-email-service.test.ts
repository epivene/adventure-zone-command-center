import { describe, expect, it } from "vitest";
import { canOfficeEditDraft, canOfficeSubmitDraft } from "./office-email-service";

describe("Office email draft lifecycle", () => {
  it("allows editing Draft and Needs Changes only", () => {
    expect(canOfficeEditDraft("draft")).toBe(true);
    expect(canOfficeEditDraft("needs_changes")).toBe(true);
    expect(canOfficeEditDraft("submitted")).toBe(false);
    expect(canOfficeEditDraft("sending")).toBe(false);
    expect(canOfficeEditDraft("sent")).toBe(false);
  });

  it("allows submitting Draft and Needs Changes only", () => {
    expect(canOfficeSubmitDraft("draft")).toBe(true);
    expect(canOfficeSubmitDraft("needs_changes")).toBe(true);
    expect(canOfficeSubmitDraft("submitted")).toBe(false);
    expect(canOfficeSubmitDraft("sent")).toBe(false);
  });
});
