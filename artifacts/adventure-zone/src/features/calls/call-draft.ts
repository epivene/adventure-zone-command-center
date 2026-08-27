import type {
  CallDirection,
  CallDisposition,
  CallMethod,
  CallScriptKind,
} from "./call-types";

const DRAFT_VERSION = 1 as const;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export type CallDraftContext = {
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
};

export type CallDraft = {
  version: typeof DRAFT_VERSION;
  savedAt: string;
  requestKey: string;
  selectedPhoneId: string | null;
  direction: CallDirection;
  method: CallMethod;
  scriptKind: CallScriptKind;
  note: string;
  disposition: CallDisposition;
  nextActionKind: string;
  nextActionDate: string;
  lastResortConfirmed: boolean;
  lastResortReason: string;
  doNotCallConfirmed: boolean;
  doNotCallReason: string;
  doNotCallPhoneId: string | null;
};

function browserStorage(): Storage {
  return window.localStorage;
}

export function buildCallDraftKey(context: CallDraftContext) {
  const part = (value: string | null) => value ?? "none";
  return [
    "assisted-call-draft",
    "v1",
    part(context.organizationId),
    part(context.contactId),
    part(context.bookingId),
    part(context.followUpId),
  ].join(":");
}

function safeDraft(value: unknown): CallDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (
    draft.version !== DRAFT_VERSION ||
    typeof draft.savedAt !== "string" ||
    typeof draft.requestKey !== "string" ||
    !(typeof draft.selectedPhoneId === "string" || draft.selectedPhoneId === null) ||
    !["incoming", "outgoing"].includes(String(draft.direction)) ||
    !["standard_call", "office_call", "individual_voicemail", "mobile_log"].includes(String(draft.method)) ||
    !["first_outreach", "follow_up", "contract_follow_up", "incoming_inquiry"].includes(String(draft.scriptKind)) ||
    typeof draft.note !== "string" ||
    ![
      "no_answer", "left_voicemail", "follow_up_needed", "email_requested", "interested",
      "proposal_contract_sent", "booked", "declined", "move_to_last_resort",
      "spoke_with_contact", "wrong_number", "do_not_call",
    ].includes(String(draft.disposition)) ||
    typeof draft.nextActionKind !== "string" ||
    typeof draft.nextActionDate !== "string" ||
    typeof draft.lastResortConfirmed !== "boolean" ||
    typeof draft.lastResortReason !== "string" ||
    typeof draft.doNotCallConfirmed !== "boolean" ||
    typeof draft.doNotCallReason !== "string" ||
    !(typeof draft.doNotCallPhoneId === "string" || draft.doNotCallPhoneId === null || draft.doNotCallPhoneId === undefined)
  ) return null;

  return {
    version: DRAFT_VERSION,
    savedAt: draft.savedAt,
    requestKey: draft.requestKey,
    selectedPhoneId: draft.selectedPhoneId as string | null,
    direction: draft.direction as CallDirection,
    method: draft.method as CallMethod,
    scriptKind: draft.scriptKind as CallScriptKind,
    note: draft.note,
    disposition: draft.disposition as CallDisposition,
    nextActionKind: draft.nextActionKind,
    nextActionDate: draft.nextActionDate,
    lastResortConfirmed: draft.lastResortConfirmed,
    lastResortReason: draft.lastResortReason,
    doNotCallConfirmed: draft.doNotCallConfirmed,
    doNotCallReason: draft.doNotCallReason,
    doNotCallPhoneId: typeof draft.doNotCallPhoneId === "string" ? draft.doNotCallPhoneId : null,
  };
}

export function loadCallDraft(
  key: string,
  now = new Date(),
  storage: Storage = browserStorage(),
): CallDraft | null {
  const serialized = storage.getItem(key);
  if (!serialized) return null;
  try {
    const draft = safeDraft(JSON.parse(serialized));
    const savedAt = draft ? new Date(draft.savedAt).getTime() : Number.NaN;
    if (
      !draft ||
      !Number.isFinite(savedAt) ||
      now.getTime() - savedAt > DRAFT_MAX_AGE_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function saveCallDraft(
  key: string,
  draft: CallDraft,
  now = new Date(),
  storage: Storage = browserStorage(),
) {
  const safe = safeDraft({
    ...draft,
    version: DRAFT_VERSION,
    savedAt: now.toISOString(),
  });
  if (safe) storage.setItem(key, JSON.stringify(safe));
}

export function clearCallDraft(
  key: string,
  storage: Storage = browserStorage(),
) {
  storage.removeItem(key);
}
