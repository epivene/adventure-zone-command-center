import { describe, expect, it } from "vitest";
import {
  canOfficeCancelDraft,
  canOfficeEditDraft,
  canOfficeSubmitDraft,
} from "./office-email-service";

describe("Office email draft lifecycle", () => {
  it("allows editing active unsent Design Studio states", () => {
    expect(canOfficeEditDraft("draft")).toBe(true);
    expect(canOfficeEditDraft("needs_changes")).toBe(true);
    expect(canOfficeEditDraft("gmail_draft")).toBe(true);
    expect(canOfficeEditDraft("scheduled")).toBe(true);
    expect(canOfficeEditDraft("failed")).toBe(true);
    expect(canOfficeEditDraft("submitted")).toBe(false);
    expect(canOfficeEditDraft("sending")).toBe(false);
    expect(canOfficeEditDraft("sent")).toBe(false);
  });

  it("allows cancellation only while a schedule is waiting", () => {
    expect(canOfficeCancelDraft("scheduled")).toBe(true);
    expect(canOfficeCancelDraft("sending")).toBe(false);
    expect(canOfficeCancelDraft("sent")).toBe(false);
  });

  it("allows submitting Draft and Needs Changes only", () => {
    expect(canOfficeSubmitDraft("draft")).toBe(true);
    expect(canOfficeSubmitDraft("needs_changes")).toBe(true);
    expect(canOfficeSubmitDraft("submitted")).toBe(false);
    expect(canOfficeSubmitDraft("sent")).toBe(false);
  });
});
