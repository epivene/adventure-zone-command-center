import type { OfficeEmailState } from "@/db/schema";

export function canOfficeEditDraft(state: OfficeEmailState) {
  return [
    "draft",
    "needs_changes",
    "gmail_draft",
    "scheduled",
    "failed",
  ].includes(state);
}

export function canOfficeCancelDraft(state: OfficeEmailState) {
  return state === "scheduled";
}

export function canOfficeSubmitDraft(state: OfficeEmailState) {
  return state === "draft" || state === "needs_changes";
}

export type OfficeEmailErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "CONTACT_NOT_LINKED"
  | "EMAIL_REQUIRED"
  | "SEND_LOCKED"
  | "INVALID_TEMPLATE"
  | "INVALID_BOOKING"
  | "UNRESOLVED_TEMPLATE_FIELD";

export class OfficeEmailError extends Error {
  constructor(public readonly code: OfficeEmailErrorCode) {
    super(code);
    this.name = "OfficeEmailError";
  }
}
