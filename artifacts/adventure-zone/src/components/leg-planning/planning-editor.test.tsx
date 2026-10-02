import { act } from "@testing-library/react";
import { notifyLegPlanningChanged } from "@/features/bookings/booking-operations-changes";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EventPlanEditor } from "./event-plan-editor";
import { LegSeasonEditor } from "./leg-season-editor";
import { PackageSetEditor, DaveAuthorityEditor } from "./package-set-editor";
import * as planningClientModule from "@/features/leg-planning/planning-client";
import { CrewAvailabilityEditor } from "./leg-season-editor";
import { ApprovalReview } from "./approval-review";
import { planningFixture, planningIds } from "@/test/leg-planning-fixture";
afterEach(cleanup);
it("Dave binding adopts each saved revision before rebinding or revoking again", async () => {
  const c = client();
  let authority: any = null;
  const configured = {
    ...c,
    catalog: vi.fn(async () => ({
      ...planningFixture().catalog!,
      bossAccounts: [{ id: planningIds.set, name: "Actual Dave" }],
    })),
    get: vi.fn(async () => authority),
    write: vi.fn(async (_path: string, input: any) => {
      authority = {
        ...input.payload,
        revision: (authority?.revision ?? 0) + 1,
      };
      return {
        value: authority,
        affectedBookingIds: [],
        receiptId: "test",
        idempotent: false,
      };
    }),
  };
  const spy = vi
    .spyOn(planningClientModule, "usePlanningClient")
    .mockReturnValue(configured as never);
  try {
    render(<DaveAuthorityEditor />);
    const select = await screen.findByLabelText("Dave approval account");
    fireEvent.change(select, { target: { value: planningIds.set } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save Dave authority" }),
    );
    await waitFor(() => expect(configured.get).toHaveBeenCalledTimes(2));
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save Dave authority" }),
    );
    await waitFor(() => expect(configured.write).toHaveBeenCalledTimes(2));
    expect(configured.write.mock.calls[1][1].expectedRevision).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
it("disables commitment during a fresh readiness check and after a failed reread", async () => {
  const read = planningFixture();
  read.readiness.overall = "verified_plan";
  let reject!: (e: Error) => void;
  const c = {
    ...client(),
    read: vi
      .fn()
      .mockResolvedValueOnce(read)
      .mockImplementation(
        () =>
          new Promise((_r, j) => {
            reject = j;
          }),
      ),
  };
  render(
    <EventPlanEditor bookingId={planningIds.booking} role="owner" client={c} />,
  );
  const commit = await screen.findByRole("button", {
    name: "Commit verified plan",
  });
  expect(commit).toBeEnabled();
  act(() =>
    notifyLegPlanningChanged({
      value: {},
      affectedBookingIds: [planningIds.other],
    }),
  );
  await waitFor(() => expect(c.read).toHaveBeenCalledTimes(2));
  expect(commit).toBeDisabled();
  await act(async () => reject(new Error("Current facts unavailable")));
  expect(commit).toBeDisabled();
});
it("records sourced dated availability separately from historical worker eligibility", async () => {
  const c = client();
  render(<CrewAvailabilityEditor role="manager" client={c} />);
  await screen.findByLabelText("Availability worker");
  fireEvent.change(screen.getByLabelText("Availability worker"), {
    target: { value: planningIds.worker },
  });
  fireEvent.change(screen.getByLabelText("Availability date meaning"), {
    target: { value: "inclusive_date" },
  });
  fireEvent.change(screen.getByLabelText("Availability start"), {
    target: { value: "2027-07-01" },
  });
  fireEvent.change(screen.getByLabelText("Availability end"), {
    target: { value: "2027-07-10" },
  });
  fireEvent.change(screen.getByLabelText("Availability state"), {
    target: { value: "unavailable" },
  });
  fireEvent.change(screen.getByLabelText("Availability evidence"), {
    target: { value: "Worker confirmed another commitment" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save dated availability" }),
  );
  await waitFor(() => expect(c.write).toHaveBeenCalled());
  expect(c.write.mock.calls[0][1].payload).toMatchObject({
    workerId: planningIds.worker,
    state: "unavailable",
    window: {
      startsAt: "2027-07-01",
      endsAt: "2027-07-10",
      semantics: "inclusive_date",
    },
    source: { label: "Worker confirmed another commitment" },
  });
});
it("shows identical facts to Dave and a generic boss but gates the exact decision", async () => {
  const q = {
    id: planningIds.set,
    type: "split" as const,
    bookingIds: [planningIds.booking, planningIds.other],
    parentLegId: planningIds.leg,
    planFingerprint: "a".repeat(64),
    state: "pending" as const,
    revision: 1,
    createdAt: "2026-10-02T00:00:00Z",
  };
  const c = {
    ...client(),
    approvals: vi.fn(async () => [
      {
        request: q,
        plans: [planningFixture(), planningFixture(planningIds.other)],
        canDecide: false,
      },
    ]),
  };
  const r = render(<ApprovalReview requestId={q.id} role="boss" client={c} />);
  await screen.findByText("split · pending");
  expect(
    screen.getAllByText("Record actual staffing and equipment.").length,
  ).toBe(10);
  expect(
    screen.queryByRole("button", { name: "Approve exact plan" }),
  ).not.toBeInTheDocument();
  r.unmount();
  c.approvals.mockResolvedValue([
    {
      request: q,
      plans: [planningFixture(), planningFixture(planningIds.other)],
      canDecide: true,
    },
  ]);
  render(<ApprovalReview requestId={q.id} role="boss" client={c} />);
  await screen.findByLabelText("Decision reason");
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Both crews and separate equipment reviewed" },
  });
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed the strategic impact if both sites need full Adventure Zone crews.",
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Approve exact plan", hidden: true }),
  );
  await waitFor(() => expect(c.write).toHaveBeenCalled());
  expect(c.write.mock.calls[0][1]).toMatchObject({
    expectedRevision: 1,
    payload: { requestId: q.id, decision: { strategicAcknowledgement: true } },
  });
});
it("hides operating controls when verified capability is absent", async () => {
  const c = {
    ...client(),
    read: vi.fn(async () => ({ ...planningFixture(), catalog: undefined })),
  };
  render(
    <EventPlanEditor bookingId={planningIds.booking} role="boss" client={c} />,
  );
  await waitFor(() => expect(c.read).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "Save draft" }),
  ).not.toBeInTheDocument();
});
function client() {
  return {
    read: vi.fn(async () => planningFixture()),
    catalog: vi.fn(async () => planningFixture().catalog),
    save: vi.fn(async (p: any) => ({
      value: {
        bookingId: p.bookingId,
        revision: 2,
        draft: p,
        committed: null,
        invalidationReasons: [],
      },
      affectedBookingIds: [p.bookingId],
    })),
    season: vi.fn(async () => null),
    write: vi.fn(async (_path: string, p: any) => ({
      value: { ...p.payload, revision: 1 },
      affectedBookingIds: [],
    })),
  } as any;
}
it("saves incomplete drafts with selected season, requirements, actual equipment and unknown lodging", async () => {
  const c = client();
  render(
    <EventPlanEditor bookingId={planningIds.booking} role="owner" client={c} />,
  );
  await screen.findByLabelText("Plan season");
  fireEvent.change(screen.getByLabelText("Plan season"), {
    target: { value: "2028" },
  });
  fireEvent.change(screen.getByLabelText("Minimum crew"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByLabelText("Actual AZ set · unverified"));
  expect(screen.getByLabelText("Accommodation need")).toHaveValue("unknown");
  expect(
    screen.getByRole("button", { name: "Commit verified plan" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(c.save).toHaveBeenCalled());
  expect(c.save.mock.calls[0][0]).toMatchObject({
    seasonYear: 2028,
    requirements: { minimumCrew: 4, lodging: "unknown" },
    packageSetIds: [planningIds.set],
  });
  expect(
    screen.getByRole("button", {
      name: "Request extra Adventure Zone approval",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Request extra Pirates approval" }),
  ).toBeInTheDocument();
});
it("season setup uses the selected year and real workers without inventing a leader", async () => {
  const c = client();
  render(
    <LegSeasonEditor
      legId={planningIds.leg}
      seasonYear={2028}
      role="owner"
      client={c}
    />,
  );
  await screen.findByRole("button", { name: "Save season plan" });
  expect(screen.getByLabelText("Leadership")).toHaveValue("unfilled");
  fireEvent.click(screen.getByLabelText("Actual worker"));
  fireEvent.click(screen.getByRole("button", { name: "Save season plan" }));
  await waitFor(() => expect(c.write).toHaveBeenCalled());
  expect(c.write.mock.calls[0][1].payload).toMatchObject({
    seasonYear: 2028,
    workerIds: [planningIds.worker],
    managerName: null,
  });
});
it("owner verifies physical composition while boss has no shared inventory editing controls", async () => {
  const c = client();
  const r = render(<PackageSetEditor role="boss" client={c} />);
  expect(
    screen.queryByRole("button", { name: "Save physical set" }),
  ).not.toBeInTheDocument();
  r.unmount();
  render(<PackageSetEditor role="owner" client={c} />);
  await screen.findByText("Actual trailer · available");
  fireEvent.change(screen.getByLabelText("Physical set name"), {
    target: { value: "Verified extra set" },
  });
  fireEvent.change(screen.getByLabelText("Package"), {
    target: { value: planningIds.pkg },
  });
  fireEvent.click(screen.getByLabelText("Actual trailer · available"));
  fireEvent.click(
    screen.getByRole("button", { name: "Add required category" }),
  );
  fireEvent.change(screen.getByLabelText("Required category 1"), {
    target: { value: "Trailer" },
  });
  fireEvent.change(screen.getByLabelText("Required count 1"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Verification source"), {
    target: { value: "Inspected equipment today" },
  });
  fireEvent.click(
    screen.getByLabelText("Verify complete physical composition"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save physical set" }));
  await waitFor(() => expect(c.write).toHaveBeenCalled());
  expect(c.write.mock.calls[0][1].payload).toMatchObject({
    requirements: { Trailer: 1 },
    resourceIds: [planningIds.resource],
    verify: true,
  });
});
