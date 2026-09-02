import { beforeEach, describe, expect, it } from "vitest";

import {
  buildCallDraftKey,
  loadCallDraft,
  saveCallDraft,
  type CallDraft,
} from "./call-draft";

const context = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  bookingId: null,
  followUpId: "40000000-0000-4000-8000-000000000001",
};

const draft: CallDraft = {
  version: 1,
  savedAt: "2026-08-01T00:00:00.000Z",
  requestKey: "70000000-0000-4000-8000-000000000001",
  selectedPhoneId: "50000000-0000-4000-8000-000000000001",
  direction: "outgoing",
  method: "individual_voicemail",
  scriptKind: "follow_up",
  note: "Call back about the contract.",
  disposition: "left_voicemail",
  nextActionKind: "call",
  nextActionDate: "2026-08-15",
  lastResortConfirmed: false,
  lastResortReason: "",
  doNotCallConfirmed: false,
  doNotCallReason: "",
  doNotCallPhoneId: null,
};

describe("call draft storage", () => {
  beforeEach(() => localStorage.clear());

  it("expires drafts after seven days", () => {
    const key = buildCallDraftKey(context);
    localStorage.setItem(key, JSON.stringify(draft));

    expect(loadCallDraft(key, new Date("2026-08-09T00:00:00.000Z"))).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("distinguishes every call context in the storage key", () => {
    expect(buildCallDraftKey(context)).toBe(
      "assisted-call-draft:v1:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001:none:40000000-0000-4000-8000-000000000001",
    );
    expect(buildCallDraftKey({ ...context, followUpId: null })).not.toBe(
      buildCallDraftKey(context),
    );
  });

  it("persists only the draft-safe calling fields", () => {
    const key = buildCallDraftKey(context);
    saveCallDraft(
      key,
      {
        ...draft,
        phoneNumberSnapshot: "701-555-0199",
        transcript: "must not persist",
      } as CallDraft,
      new Date("2026-08-02T00:00:00.000Z"),
    );

    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      ...draft,
      savedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("rejects a tampered browser-VoIP draft instead of restoring its technical linkage", () => {
    const key = buildCallDraftKey(context);
    localStorage.setItem(key, JSON.stringify({ ...draft, method: "browser_voip" }));

    expect(loadCallDraft(key, new Date("2026-08-02T00:00:00.000Z"))).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("never persists browser-VoIP request linkage into a resumable draft", () => {
    const key = buildCallDraftKey(context);
    saveCallDraft(
      key,
      { ...draft, method: "browser_voip", requestKey: "technical-session-id" },
      new Date("2026-08-02T00:00:00.000Z"),
    );

    expect(localStorage.getItem(key)).toBeNull();
  });

  it("removes an existing Phone Link draft when browser-VoIP linkage is rejected", () => {
    const key = buildCallDraftKey(context);
    saveCallDraft(key, draft, new Date("2026-08-02T00:00:00.000Z"));

    saveCallDraft(
      key,
      { ...draft, method: "browser_voip", requestKey: "technical-session-id" },
      new Date("2026-08-02T00:00:01.000Z"),
    );

    expect(localStorage.getItem(key)).toBeNull();
  });
});
