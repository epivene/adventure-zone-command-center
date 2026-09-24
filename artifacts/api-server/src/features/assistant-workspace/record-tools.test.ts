import { it, expect, vi } from "vitest";
import {
  mutationAllowed,
  validateRecordAction,
  assertMutationGrant,
} from "./record-tools";
const grant = {
  actorId: "owner",
  sourceMessageId: "u1",
  actionKind: "create_followup",
  targetIds: ["profile-a"],
  revision: null,
  connectionId: null,
};
it("does not turn a new reminder request into permission to reschedule old ones", () => {
  expect(mutationAllowed([grant], "update_followup", "old-reminder")).toBe(
    false,
  );
  expect(mutationAllowed([grant], "create_followup", "profile-a")).toBe(true);
});
it("cannot use a grant belonging to another actor, source or target", () => {
  const intent = {
    actorId: "owner",
    sourceMessageId: "u1",
    kind: "create_followup",
    targetId: "profile-a",
    expectedRevision: null,
    connectionId: null,
  };
  expect(() => assertMutationGrant([grant], intent)).not.toThrow();
  for (const patch of [
    { actorId: "other" },
    { sourceMessageId: "u2" },
    { targetId: "profile-b" },
    { connectionId: "changed" },
  ])
    expect(() => assertMutationGrant([grant], { ...intent, ...patch })).toThrow(
      "ASSISTANT_ACTION_NOT_AUTHORIZED",
    );
});
it("rejects inferred financial status and unknown fields", () => {
  expect(() =>
    validateRecordAction("update_profile", { paid: true }),
  ).toThrow();
  expect(() =>
    validateRecordAction("update_profile", { status: "confirmed" }),
  ).toThrow();
  expect(validateRecordAction("update_profile", { city: "Boise" })).toEqual({
    city: "Boise",
  });
});
it("requires explicit time on reminders and preserves distinct update commands", () => {
  expect(() =>
    validateRecordAction("create_followup", {
      kind: "email",
      dueAt: "next week",
      bookingId: null,
      contactId: null,
    }),
  ).toThrow();
  expect(
    validateRecordAction("create_followup", {
      kind: "email",
      dueAt: "2027-01-02T10:00:00-07:00",
      bookingId: null,
      contactId: null,
    }),
  ).toMatchObject({ kind: "email" });
});
