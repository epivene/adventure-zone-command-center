import { afterEach, beforeEach, expect, it } from "vitest";
import { planningDatabase } from "./planning-test-database";
import { LegPlanningService } from "./planning-service";
import {
  actors,
  draft,
  ids,
  completeFacts,
  source,
  fixtureWindow,
} from "./planning-fixtures";
let fixture: Awaited<ReturnType<typeof planningDatabase>>;
let service: LegPlanningService;
beforeEach(async () => {
  fixture = await planningDatabase();
  service = new LegPlanningService(fixture.db as never);
});
afterEach(async () => {
  await fixture?.pg.close();
});
const write = <T>(
  payload: T,
  requestKey: string,
  expectedRevision: number | null = null,
) => ({ payload, requestKey, expectedRevision });
it("replays the same receipt, rejects a changed body, and rolls back stale revisions", async () => {
  const first = await service.saveDraft(
    actors.owner,
    write(draft(), "draft-1"),
  );
  const retry = await service.saveDraft(
    actors.owner,
    write(draft(), "draft-1"),
  );
  expect(retry.receiptId).toBe(first.receiptId);
  expect(retry.idempotent).toBe(true);
  await expect(
    service.saveDraft(
      actors.owner,
      write(draft({ seasonYear: 2028 }), "draft-1"),
    ),
  ).rejects.toMatchObject({ code: "REQUEST_KEY_REUSED" });
  await expect(
    service.saveDraft(actors.owner, write(draft(), "draft-stale", null)),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect((await service.get(ids.booking, actors.owner))?.plan?.revision).toBe(
    1,
  );
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM leg_plan_mutation_receipts",
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
});
it("keeps setup factual, scoping manager availability and shared inventory to their authority", async () => {
  const season = completeFacts().season!;
  const { revision: _revision, ...input } = season;
  expect(
    (await service.saveSeason(actors.manager, write(input, "season"))).value
      .leadership,
  ).toBe("confirmed");
  await expect(
    service.saveAvailability(
      { ...actors.manager, legId: ids.otherBooking },
      write(
        {
          id: null,
          workerId: ids.worker,
          window: fixtureWindow,
          state: "confirmed",
          source,
        },
        "availability",
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.savePackageSet(
      actors.manager,
      write(
        {
          id: null,
          packageId: ids.package,
          name: "Actual set",
          classification: "normal",
          resourceIds: [ids.resource],
          requirements: { Pool: 1 },
          verify: true,
          source,
        },
        "set",
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.saveDaveAuthority(
      actors.dave,
      write({ accountId: ids.boss }, "authority"),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it("server-stamps travel review and preserves its timestamp on an identical save", async () => {
  const d = draft({ loadInAddress: "Fair gate" });
  const first = await service.saveDraft(actors.owner, write(d, "draft"));
  const facts = (await service.facts(ids.booking, actors.owner))[0];
  const reviewed = {
    ...d,
    travelReview: {
      endpointFingerprint: facts.travel.endpointFingerprint,
      source,
      reviewedAt: "2000-01-01T00:00:00Z",
    },
  };
  const second = await service.saveDraft(
    actors.owner,
    write(reviewed, "review", first.value.revision),
  );
  expect(second.value.draft.travelReview?.reviewedAt).not.toBe(
    reviewed.travelReview.reviewedAt,
  );
  const third = await service.saveDraft(
    actors.owner,
    write(second.value.draft, "noop", second.value.revision),
  );
  expect(third.value.draft.travelReview?.reviewedAt).toBe(
    second.value.draft.travelReview?.reviewedAt,
  );
});
