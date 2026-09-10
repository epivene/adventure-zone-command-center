import { describe, expect, it } from "vitest";
import {
  evaluateOutreach,
  compareOutreachPriority,
  type OutreachPolicyInput,
  type OutreachAttempt,
} from "./outreach-policy";
const base: OutreachPolicyInput = {
  tier: "strong",
  status: "ready_to_contact",
  attempts: [],
  meaningfulReplyAt: null,
  decisionDueAt: null,
  conventionEndsOn: null,
  operationalStartsOn: null,
  blockedReason: null,
};
const initial: OutreachAttempt = {
  id: "a",
  occurredAt: "2026-09-01T18:00:00Z",
  stage: "initial",
  successful: true,
};
const first: OutreachAttempt = {
  ...initial,
  id: "b",
  occurredAt: "2026-09-08T18:00:00Z",
  stage: "follow_up_1",
};
const second: OutreachAttempt = {
  ...initial,
  id: "c",
  occurredAt: "2026-09-15T18:00:00Z",
  stage: "follow_up_2",
};
const now = new Date("2026-09-30T18:00:00Z");
const decide = (patch: Partial<OutreachPolicyInput>, at = now) =>
  evaluateOutreach({ ...base, ...patch }, at);
describe("outreach evidence and cadence", () => {
  it("requires completed followups before advancing", () => {
    expect(decide({ attempts: [initial] }).state).toBe("follow_up");
    expect(decide({ attempts: [initial, first, second] }).state).toBe(
      "advance",
    );
  });
  it("uses 7/14/21 days and does not compress a delayed chase", () => {
    expect(
      decide({ attempts: [initial] }, new Date("2026-09-07T18:00Z")).state,
    ).toBe("waiting");
    expect(
      decide({ attempts: [initial, first] }, new Date("2026-09-15T18:00Z"))
        .nextStage,
    ).toBe("follow_up_2");
    expect(
      decide({
        attempts: [initial, { ...first, occurredAt: "2026-09-29T18:00:00Z" }],
      }).dueAt,
    ).toBe("2026-10-06T18:00:00.000Z");
  });
  it("deduplicates ids, requires success and ordered stages", () => {
    expect(decide({ attempts: [initial, initial] }).nextStage).toBe(
      "follow_up_1",
    );
    expect(
      decide({ attempts: [{ ...initial, successful: false }] }).state,
    ).toBe("ready");
    expect(decide({ attempts: [initial, second] }).state).toBe("needs_review");
    expect(
      decide({
        attempts: [initial, { ...first, occurredAt: initial.occurredAt }],
      }).state,
    ).toBe("needs_review");
    expect(
      decide({ attempts: [initial, { ...initial, successful: false }] }).state,
    ).toBe("needs_review");
  });
  it.each([
    "2026-02-30T18:00:00Z",
    "2026-09-01",
    "2026-10-01T18:00:00Z",
    "bad",
  ])("rejects invalid/future evidence %s", (occurredAt) => {
    expect(decide({ attempts: [{ ...initial, occurredAt }] }).state).toBe(
      "needs_review",
    );
  });
  it.each([
    "booked",
    "declined",
    "not_pursuing",
    "no_response",
    "territory_hold",
    "cancelled",
  ])("closes %s", (status) => expect(decide({ status }).state).toBe("closed"));
  it("respects blockers, replies, decisions and tier review", () => {
    expect(decide({ blockedReason: "hold" }).state).toBe("needs_review");
    for (const status of ["interested", "booking_in_progress"])
      expect(decide({ status, operationalStartsOn: "2026-10-01" }).state).toBe(
        "reply",
      );
    expect(decide({ meaningfulReplyAt: initial.occurredAt }).state).toBe(
      "reply",
    );
    expect(
      decide({
        decisionDueAt: initial.occurredAt,
        operationalStartsOn: "2026-10-01",
      }).state,
    ).toBe("decision");
    expect(decide({ decisionDueAt: "2026-10-01T18:00:00Z" }).state).toBe(
      "waiting",
    );
    expect(decide({ tier: "unclassified" }).state).toBe("needs_review");
    expect(decide({ operationalStartsOn: "2026-10-01" }).state).toBe(
      "needs_review",
    );
  });
  it("uses Chicago business days across weekends and DST", () => {
    const result = decide(
      { tier: "convention", conventionEndsOn: "2026-03-06" },
      new Date("2026-03-07T01:00:00Z"),
    );
    expect(result.state).toBe("ready");
    expect(result.dueAt).toBe("2026-03-10T17:00:00.000Z");
    expect(decide({ tier: "convention" }).state).toBe("needs_review");
  });
  it("sorts by tier, manual rank, stable id", () => {
    const rows = [
      { tier: "filler" as const, manualRank: 0, id: "a" },
      { tier: "strong" as const, manualRank: 2, id: "b" },
      { tier: "convention" as const, manualRank: 9, id: "c" },
      { tier: "strong" as const, manualRank: 1, id: "e" },
      { tier: "strong" as const, manualRank: 1, id: "d" },
    ];
    expect(rows.sort(compareOutreachPriority).map((x) => x.id)).toEqual([
      "c",
      "d",
      "e",
      "b",
      "a",
    ]);
  });
});

describe("policy boundaries", () => {
  it("waits the last seven days before advancing", () => {
    expect(
      decide(
        { attempts: [initial, first, second] },
        new Date("2026-09-21T18:00:00Z"),
      ).state,
    ).toBe("waiting");
    expect(
      decide(
        { attempts: [initial, first, second] },
        new Date("2026-09-22T18:00:00Z"),
      ).state,
    ).toBe("advance");
  });
  it("reviews invalid ancillary dates and future replies", () => {
    for (const patch of [
      { meaningfulReplyAt: "2026-10-01T18:00:00Z" },
      { decisionDueAt: "2026-02-30T18:00:00Z" },
      { operationalStartsOn: "2026-02-30" },
      { conventionEndsOn: "2026-02-30" },
    ])
      expect(decide(patch).state).toBe("needs_review");
  });
  it("uses the Chicago date at UTC midnight for the 45 day boundary", () => {
    expect(
      decide(
        { operationalStartsOn: "2026-11-14" },
        new Date("2026-09-30T01:00:00Z"),
      ).state,
    ).toBe("ready");
    expect(decide({ operationalStartsOn: "2026-11-14" }, now).state).toBe(
      "needs_review",
    );
  });
  it("uses winter offset after autumn DST change", () => {
    expect(
      decide({ tier: "convention", conventionEndsOn: "2026-10-30" }).dueAt,
    ).toBe("2026-11-03T18:00:00.000Z");
  });
  it("requires review of malformed attempts even when interest exists", () => {
    expect(
      decide({
        status: "interested",
        attempts: [{ ...initial, occurredAt: "bad" }],
      }).state,
    ).toBe("needs_review");
  });
});

it("rolls routine weekend cadence to Monday in Chicago without shortening elapsed time", () => {
  const sunday = { ...initial, occurredAt: "2026-03-01T18:00:00Z" };
  expect(
    decide({ attempts: [sunday] }, new Date("2026-03-08T19:00:00Z")).dueAt,
  ).toBe("2026-03-09T18:00:00.000Z");
  expect(
    decide({ attempts: [sunday] }, new Date("2026-03-08T19:00:00Z")).state,
  ).toBe("waiting");
  expect(
    decide(
      { decisionDueAt: "2026-03-08T18:00:00Z" },
      new Date("2026-03-08T19:00:00Z"),
    ).state,
  ).toBe("decision");
});

it.each([
  ["2026-10-25T05:30:00Z", "2026-11-02T06:30:00.000Z"],
  ["2026-03-01T06:30:00Z", "2026-03-09T05:30:00.000Z"],
])(
  "preserves pre-transition Sunday wall clock when rolling %s",
  (occurredAt, expected) => {
    const result = decide(
      { attempts: [{ ...initial, occurredAt }] },
      new Date("2026-12-01T18:00:00Z"),
    );
    expect(result.dueAt).toBe(expected);
    expect(new Date(result.dueAt!).getTime()).toBeGreaterThanOrEqual(
      Date.parse(occurredAt) + 7 * 86400000,
    );
  },
);
it.each(["constructor", "toString", "__proto__", "unknown"])(
  "reviews runtime unknown tier %s and sorts it after classified tiers",
  (value) => {
    const tier = value as OutreachPolicyInput["tier"];
    expect(decide({ tier }).state).toBe("needs_review");
    const unknown = { tier, manualRank: -100, id: "a" };
    const classified = { tier: "filler" as const, manualRank: 100, id: "b" };
    expect(compareOutreachPriority(unknown, classified)).toBeGreaterThan(0);
    expect(compareOutreachPriority(classified, unknown)).toBeLessThan(0);
  },
);

describe("owner cadence and snooze", () => {
  const short = {
    days: [2, 4, 6] as [number, number, number],
    minimumGapDays: 2,
    reason: "Owner reviewed the available timeline",
  };
  it("uses explicit increasing days and still waits after a delayed follow-up", () => {
    expect(
      evaluateOutreach(
        { ...base, attempts: [initial] },
        new Date("2026-09-03T18:00:00Z"),
        short,
      ).state,
    ).toBe("follow_up");
    expect(
      evaluateOutreach(
        {
          ...base,
          attempts: [initial, { ...first, occurredAt: "2026-09-29T18:00:00Z" }],
        },
        now,
        short,
      ).dueAt,
    ).toBe("2026-10-01T18:00:00.000Z");
    expect(
      evaluateOutreach(base, now, { ...short, days: [2, 2, 3] }).state,
    ).toBe("needs_review");
    expect(
      evaluateOutreach(base, now, { ...short, minimumGapDays: 0 }).state,
    ).toBe("needs_review");
  });
  it("keeps replies, decisions and uncertain evidence above a snooze", () => {
    const input = { ...base, snoozedUntil: "2026-11-01T18:00:00Z" };
    expect(evaluateOutreach(input, now, short).state).toBe("waiting");
    expect(
      evaluateOutreach({ ...input, tier: "unclassified" }, now, short).state,
    ).toBe("needs_review");
    expect(
      evaluateOutreach(
        { ...input, tier: "convention", conventionEndsOn: null },
        now,
        short,
      ).state,
    ).toBe("needs_review");
    expect(
      evaluateOutreach(
        { ...input, meaningfulReplyAt: initial.occurredAt },
        now,
        short,
      ).state,
    ).toBe("reply");
    expect(
      evaluateOutreach(
        { ...input, decisionDueAt: initial.occurredAt },
        now,
        short,
      ).state,
    ).toBe("decision");
    expect(
      evaluateOutreach(
        { ...input, blockedReason: "Source unavailable" },
        now,
        short,
      ).state,
    ).toBe("needs_review");
    expect(
      evaluateOutreach(
        { ...input, latestActualAttemptAt: "2026-11-01T18:00:00Z" },
        now,
        short,
      ).state,
    ).toBe("needs_review");
    expect(
      evaluateOutreach(
        {
          ...input,
          attempts: [{ ...initial, occurredAt: "2026-11-01T18:00:00Z" }],
        },
        now,
        short,
      ).state,
    ).toBe("needs_review");
  });
});
