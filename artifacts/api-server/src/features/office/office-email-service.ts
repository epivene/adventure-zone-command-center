import type { OfficeEmailState } from "@/db/schema";

export function canOfficeEditDraft(state: OfficeEmailState) {
  return state === "draft" || state === "needs_changes";
}

export function canOfficeSubmitDraft(state: OfficeEmailState) {
  return state === "draft" || state === "needs_changes";
}

export class OfficeEmailError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_STATE" | "CONTACT_NOT_LINKED" | "EMAIL_REQUIRED" | "SEND_LOCKED") {
    super(code);
    this.name = "OfficeEmailError";
  }
}
