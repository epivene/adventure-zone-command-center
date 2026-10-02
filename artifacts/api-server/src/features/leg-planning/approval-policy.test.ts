import { describe, expect, it } from "vitest";
import type { ApprovalRequest, PlanFacts } from "@workspace/api-zod";
import {
  actors,
  completeFacts,
  decision,
  draft,
  ids,
} from "./planning-fixtures";
import { planningFingerprint } from "./planning-facts";
import { authorizeDecision, evaluateApprovals } from "./approval-policy";

const approve = {
  decision: "approved" as const,
  reason: "Reviewed staffing and physical equipment",
  strategicAcknowledgement: false,
};
function request(
  f: PlanFacts,
  type: ApprovalRequest["type"] = "extra_pirates",
): ApprovalRequest {
  return {
    id: "00000000-0000-4000-8000-000000000013",
    type,
    bookingIds:
      type === "split" ? [ids.booking, ids.otherBooking] : [ids.booking],
    parentLegId: ids.leg,
    planFingerprint: planningFingerprint(f),
    state: "pending",
    revision: 1,
    createdAt: f.now,
  };
}
function splitFacts(twoAZ = false) {
  const f = completeFacts();
  f.draft.splitGroupId = ids.split;
  f.split = {
    id: ids.split,
    parentLegId: ids.leg,
    bookingIds: [ids.booking, ids.otherBooking],
    revision: 1,
  };
  f.branches = [
    f.draft,
    draft({
      bookingId: ids.otherBooking,
      splitGroupId: ids.split,
      crew: [
        {
          ...f.draft.crew[0],
          workerId: "00000000-0000-4000-8000-000000000014",
        },
      ],
      packageSetIds: ["00000000-0000-4000-8000-000000000015"],
    }),
  ];
  f.packageSets.push({
    ...f.packageSets[0],
    id: f.branches[1].packageSetIds[0],
    resourceIds: ["00000000-0000-4000-8000-000000000016"],
  });
  if (twoAZ) f.packages[0].code = "adventure_zone";
  return f;
}
describe("attributed leg approvals", () => {
  it.each(["window", "composition", "availability"])(
    "invalidates material %s changes",
    (kind) => {
      const f = completeFacts(),
        r = request(f);
      f.requests = [r];
      f.decisions = [decision({ planFingerprint: r.planFingerprint })];
      if (kind === "window") f.draft.window!.endsAt = "2027-07-27T12:00:00Z";
      if (kind === "composition") f.packageSets[0].resourceIds = [ids.worker];
      if (kind === "availability") f.availability[0].state = "unavailable";
      expect(evaluateApprovals(f).state).toBe("invalid");
    },
  );
  it("does not bind decisions to evaluation time or unrelated resources", () => {
    const f = completeFacts(),
      r = request(f);
    f.requests = [r];
    f.decisions = [decision({ planFingerprint: r.planFingerprint })];
    f.now = "2026-11-01T12:00:00Z";
    f.resources.push({
      ...f.resources[0],
      id: ids.worker,
      name: "Unrelated edited item",
    });
    expect(evaluateApprovals(f).extraPirates).toBe(true);
  });
  it("requires the bound enabled Dave account for extra sets", () => {
    const f = completeFacts(),
      r = request(f);
    expect(authorizeDecision(actors.dave, r, f, approve)).toEqual({
      allowed: true,
    });
    for (const actor of [
      actors.owner,
      actors.manager,
      { ...actors.dave, accountId: ids.worker },
    ])
      expect(authorizeDecision(actor, r, f, approve)).toEqual({
        allowed: false,
        code: "AUTHORITY_REQUIRED",
      });
    f.authorityEnabled = false;
    expect(authorizeDecision(actors.dave, r, f, approve).allowed).toBe(false);
  });
  it("allows the exact parent leg manager or Dave to review a split", () => {
    const f = splitFacts(),
      r = request(f, "split");
    expect(authorizeDecision(actors.manager, r, f, approve).allowed).toBe(true);
    expect(authorizeDecision(actors.dave, r, f, approve).allowed).toBe(true);
    expect(
      authorizeDecision(
        { ...actors.manager, legId: ids.otherBooking },
        r,
        f,
        approve,
      ),
    ).toEqual({ allowed: false, code: "AUTHORITY_REQUIRED" });
  });
  it("requires explicit strategic acknowledgement for two Adventure Zones without making it Dave-only", () => {
    const f = splitFacts(true),
      r = request(f, "split");
    expect(authorizeDecision(actors.manager, r, f, approve)).toEqual({
      allowed: false,
      code: "EVIDENCE_REQUIRED",
    });
    expect(
      authorizeDecision(actors.manager, r, f, {
        ...approve,
        strategicAcknowledgement: true,
      }).allowed,
    ).toBe(true);
  });
  it.each(["crew", "resource", "season"])(
    "rejects an infeasible split: %s",
    (kind) => {
      const f = splitFacts();
      if (kind === "crew") f.branches[1].crew = f.draft.crew;
      if (kind === "resource")
        f.packageSets[1].resourceIds = f.packageSets[0].resourceIds;
      if (kind === "season") f.branches[1].seasonYear = 2028;
      expect(
        authorizeDecision(actors.manager, request(f, "split"), f, approve),
      ).toEqual({ allowed: false, code: "PLAN_CONFLICT" });
    },
  );
  it("does not waive missing equipment or availability when granting extra capacity", () => {
    const f = completeFacts();
    f.packageSets[0].state = "unverified";
    expect(authorizeDecision(actors.dave, request(f), f, approve)).toEqual({
      allowed: false,
      code: "EVIDENCE_REQUIRED",
    });
    f.packageSets[0].state = "verified";
    f.availability = [];
    expect(authorizeDecision(actors.dave, request(f), f, approve).allowed).toBe(
      false,
    );
  });
  it("keeps independent split and extra approvals separate", () => {
    const f = splitFacts();
    const r = request(f, "split");
    f.requests = [r, { ...request(f), id: ids.worker }];
    expect(authorizeDecision(actors.manager, r, f, approve).allowed).toBe(true);
    f.decisions = [
      decision({
        requestId: r.id,
        actor: actors.manager,
        planFingerprint: r.planFingerprint,
      }),
    ];
    const result = evaluateApprovals(f);
    expect(result.splitGroupIds).toEqual([ids.split]);
    expect(result.extraPirates).toBe(false);
    expect(result.state).toBe("pending");
  });
  it("invalidates changed facts, disabled/rebound authority, revoked decisions, but preserves identical facts", () => {
    const f = completeFacts(),
      r = request(f);
    f.requests = [r];
    f.decisions = [decision({ planFingerprint: r.planFingerprint })];
    expect(evaluateApprovals(structuredClone(f)).extraPirates).toBe(true);
    f.draft.crew[0].role = "driver";
    expect(evaluateApprovals(f).state).toBe("invalid");
    f.draft.crew[0].role = "operator";
    f.authority!.revision++;
    expect(evaluateApprovals(f).state).toBe("invalid");
    f.authority!.revision--;
    f.authorityEnabled = false;
    expect(evaluateApprovals(f).state).toBe("invalid");
    f.authorityEnabled = true;
    f.authority!.accountId = ids.worker;
    expect(evaluateApprovals(f).state).toBe("invalid");
    f.authority!.accountId = ids.boss;
    f.decisions.push(
      decision({
        id: ids.worker,
        decision: "revoked",
        decidedAt: "2026-10-02T01:00:00Z",
        planFingerprint: r.planFingerprint,
      }),
    );
    expect(evaluateApprovals(f).extraPirates).toBe(false);
  });
  it("rejects stale requests and lets an authorized person decline an incomplete plan", () => {
    const f = completeFacts(),
      r = request(f);
    f.draft.requirements.minimumCrew = 8;
    expect(authorizeDecision(actors.dave, r, f, approve)).toEqual({
      allowed: false,
      code: "STALE_APPROVAL",
    });
    expect(
      authorizeDecision(actors.dave, request(f), f, {
        ...approve,
        decision: "declined",
      }).allowed,
    ).toBe(true);
  });
});
