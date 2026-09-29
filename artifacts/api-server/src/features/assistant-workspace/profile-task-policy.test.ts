import { changeFingerprint } from "./profile-task-evidence";
import { it, expect } from "vitest";
import { compileTaskAuthority, grantTaskAction } from "./profile-task-policy";
const id = "11111111-1111-4111-8111-111111111111";
const scope = {
  profileIds: [id],
  eventYear: 2027,
  objective: "Research",
  requestedFields: ["phone"],
  taskCapUsd: null,
};
const authority = () =>
  compileTaskAuthority({
    actorId: "owner",
    sourceMessageId: id,
    scope,
    explicitActions: ["add_profile_note", "update_profile"],
  });
const task = () =>
  ({
    id,
    actorId: "owner",
    conversationId: id,
    sourceMessageId: id,
    scope,
    authority: authority(),
    state: "running",
    version: 1,
    pauseReason: null,
    counts: {},
    items: [],
  }) as any;
const item = {
  id,
  taskId: id,
  profileId: id,
  eventYear: 2027,
  state: "researching",
} as any;
const intent = {
  id,
  actorId: "owner",
  conversationId: id,
  sourceMessageId: id,
  kind: "add_profile_note",
  targetId: id,
  expectedRevision: null,
  connectionId: null,
  arguments: { body: "Source-backed note" },
};
const proof = (i: typeof intent | any) => ({
  profileId: id,
  fingerprint: changeFingerprint(i),
  evidenceIds: ["source"],
});
it("research-only requests receive no write authority", () =>
  expect(
    compileTaskAuthority({
      actorId: "owner",
      sourceMessageId: id,
      scope,
      explicitActions: [],
    }).actionKinds,
  ).toEqual([]));
it("binds authorized notes to their exact scope and original request", () => {
  expect(
    grantTaskAction(task(), item, intent, null, undefined, proof(intent)),
  ).toMatchObject({
    actorId: "owner",
    sourceMessageId: id,
    actionKind: "add_profile_note",
    targetIds: [id],
  });
  expect(
    grantTaskAction(task(), { ...item, eventYear: 2026 }, intent, null),
  ).toBeNull();
  expect(
    grantTaskAction(task(), item, { ...intent, targetId: "other" }, null),
  ).toBeNull();
  expect(
    grantTaskAction({ ...task(), state: "paused" }, item, intent, null),
  ).toBeNull();
});
it("requires live empty fields and matching revision for automatic profile changes", () => {
  const change = {
    ...intent,
    kind: "update_profile",
    arguments: { phone: "123" },
    expectedRevision: "v1",
  };
  expect(
    grantTaskAction(task(), item, change, "v1", { phone: null }, proof(change)),
  ).not.toBeNull();
  expect(
    grantTaskAction(
      task(),
      item,
      change,
      "v1",
      { phone: "456" },
      proof(change),
    ),
  ).toBeNull();
  expect(
    grantTaskAction(task(), item, change, "v2", { phone: null }, proof(change)),
  ).toBeNull();
  expect(grantTaskAction(task(), item, change, "v1")).toBeNull();
  expect(
    grantTaskAction(
      task(),
      item,
      { ...change, arguments: { name: "New name" } },
      "v1",
      { name: null },
    ),
  ).toBeNull();
});
it("rejects destructive or external authority", () => {
  expect(() =>
    compileTaskAuthority({
      actorId: "owner",
      sourceMessageId: id,
      scope,
      explicitActions: ["send_draft"],
    }),
  ).toThrow("ASSISTANT_TASK_AUTHORITY_INVALID");
});
it("does not automatically write unsupported notes or values without a durable evidence proposal", () => {
  expect(grantTaskAction(task(), item, intent, null)).toBeNull();
  expect(
    grantTaskAction(
      task(),
      item,
      {
        ...intent,
        kind: "update_profile",
        arguments: { phone: "123" },
        expectedRevision: "v1",
      },
      "v1",
      { phone: null },
    ),
  ).toBeNull();
});
