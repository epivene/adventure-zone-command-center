import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLegPlan } from "./use-leg-plan";
import { planningFixture, planningIds } from "@/test/leg-planning-fixture";
import type { PlanningRead } from "@workspace/api-zod";
afterEach(cleanup);
it("does not apply a save from an earlier visit when A is selected again", async () => {
  let finish!: (v: any) => void;
  let next = planningFixture();
  const c = {
    read: vi.fn(async (id: string) =>
      id === planningIds.booking ? next : planningFixture(id),
    ),
    save: vi.fn(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    ),
  } as any;
  const h = renderHook(({ id }) => useLegPlan(id, "owner", c), {
    initialProps: { id: planningIds.booking },
  });
  await waitFor(() => expect(h.result.current.draft).not.toBeNull());
  let pending!: Promise<unknown>;
  act(() => {
    pending = h.result.current.save();
  });
  h.rerender({ id: planningIds.other });
  await waitFor(() =>
    expect(h.result.current.draft?.bookingId).toBe(planningIds.other),
  );
  next = planningFixture();
  next.plan!.revision = 7;
  next.plan!.draft.seasonYear = 2029;
  h.rerender({ id: planningIds.booking });
  await waitFor(() => expect(h.result.current.data?.plan?.revision).toBe(7));
  await act(async () => {
    finish({
      value: { ...planningFixture().plan, revision: 2 },
      affectedBookingIds: [planningIds.booking],
    });
    await pending;
  });
  expect(h.result.current.data?.plan?.revision).toBe(7);
  expect(h.result.current.draft?.seasonYear).toBe(2029);
  expect(c.read).toHaveBeenCalledTimes(3);
});
it("keeps the edit-base revision when fresh server facts arrive", async () => {
  const c = {
    read: vi.fn(async () => planningFixture()),
    save: vi.fn(async (p: any) => ({
      value: { ...planningFixture().plan, draft: p, revision: 3 },
      affectedBookingIds: [p.bookingId],
    })),
  } as any;
  const h = renderHook(() => useLegPlan(planningIds.booking, "owner", c));
  await waitFor(() => expect(h.result.current.draft).not.toBeNull());
  act(() =>
    h.result.current.edit({ ...h.result.current.draft!, seasonYear: 2028 }),
  );
  c.read.mockResolvedValue({
    ...planningFixture(),
    plan: { ...planningFixture().plan!, revision: 2 },
  });
  await act(async () => {
    await h.result.current.reload();
    await h.result.current.save();
  });
  expect(c.save.mock.calls[0][1]).toBe(1);
});
it("preserves unsaved edits on refresh and ignores an old selection response", async () => {
  let old!: (v: PlanningRead) => void;
  const client = {
    read: vi.fn((id: string) =>
      id === planningIds.other
        ? new Promise<PlanningRead>((r) => {
            old = r;
          })
        : Promise.resolve(planningFixture(id)),
    ),
  } as any;
  const h = renderHook(({ id }) => useLegPlan(id, "owner", client), {
    initialProps: { id: planningIds.other },
  });
  h.rerender({ id: planningIds.booking });
  await waitFor(() =>
    expect(h.result.current.draft?.bookingId).toBe(planningIds.booking),
  );
  act(() =>
    h.result.current.edit({ ...h.result.current.draft!, seasonYear: 2028 }),
  );
  await act(async () => {
    await h.result.current.reload();
    old(planningFixture(planningIds.other));
  });
  expect(h.result.current.draft?.seasonYear).toBe(2028);
  expect(h.result.current.draft?.bookingId).toBe(planningIds.booking);
});
it("a slow save for A cannot replace B or erase edits made during saving", async () => {
  let finish!: (v: any) => void;
  const client = {
    read: vi.fn(async (id: string) => planningFixture(id)),
    save: vi.fn(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    ),
  } as any;
  const h = renderHook(({ id }) => useLegPlan(id, "owner", client), {
    initialProps: { id: planningIds.booking },
  });
  await waitFor(() => expect(h.result.current.draft).not.toBeNull());
  let pending!: Promise<unknown>;
  act(() => {
    h.result.current.edit({ ...h.result.current.draft!, seasonYear: 2028 });
    pending = h.result.current.save();
  });
  h.rerender({ id: planningIds.other });
  await waitFor(() =>
    expect(h.result.current.draft?.bookingId).toBe(planningIds.other),
  );
  await act(async () => {
    finish({
      value: { ...planningFixture().plan, revision: 2 },
      affectedBookingIds: [planningIds.booking],
    });
    await pending;
  });
  expect(h.result.current.draft?.bookingId).toBe(planningIds.other);
});
