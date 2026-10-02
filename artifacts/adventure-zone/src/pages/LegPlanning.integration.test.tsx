import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { operationsFixture } from "@/test/booking-leg-operations-fixture";
import { planningFixture, planningIds } from "@/test/leg-planning-fixture";
const transport = vi.hoisted(() => ({
  get: vi.fn(),
  fetch: vi.fn(),
  search: "",
}));
vi.mock("@/lib/auth-token", () => ({
  apiGet: transport.get,
  apiFetch: transport.fetch,
}));
vi.mock("wouter", () => ({
  useSearch: () => transport.search,
  useLocation: () => ["/schedule", vi.fn()],
  Link: ({ href, children }: any) => <a href={href}>{children}</a>,
}));
vi.mock("./CalendarPage", () => ({
  CalendarContent: () => <div>Calendar remains available</div>,
}));
vi.mock("./RoutesPage", () => ({
  RoutesContent: () => <div>Map remains available</div>,
}));
import SchedulePage from "./SchedulePage";
import { BookingLegOperationsCard } from "@/components/bookings/leg-operations-panel";
import { ownerOperationsClient } from "@/features/bookings/booking-leg-operations-client";
import { notifyLegPlanningChanged } from "@/features/bookings/booking-operations-changes";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("neighbor changes refresh readiness without discarding the open draft or treating completed office work as readiness", async () => {
  const plan = planningFixture();
  let changed = false;
  transport.get.mockImplementation(async () => {
    const o = operationsFixture(planningIds.booking);
    o.planning = { state: "loaded", data: plan };
    if (changed) {
      o.bookingStatus = "confirmed";
      if (o.work.state === "loaded") o.work.data.items[0].status = "done";
    }
    return o;
  });
  transport.fetch.mockImplementation(async () => ({
    ok: true,
    json: async () => plan,
  }));
  render(
    <BookingLegOperationsCard
      bookingId={planningIds.booking}
      role="owner"
      client={ownerOperationsClient}
    />,
  );
  await screen.findByLabelText("Plan season");
  fireEvent.change(screen.getByLabelText("Plan season"), {
    target: { value: "2028" },
  });
  changed = true;
  notifyLegPlanningChanged({
    value: {},
    affectedBookingIds: [planningIds.other],
  });
  await waitFor(() =>
    expect(transport.get.mock.calls.length).toBeGreaterThan(1),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Plan season")).toHaveValue(2028),
  );
  expect(
    screen.getByText("Operating plan · needs details"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Commit verified plan", hidden: true }),
  ).toBeDisabled();
});
it("opens the exact event from schedule context and refreshes canonical assignment after plan commitment", async () => {
  let leg = "Angel";
  const plan = planningFixture();
  plan.plan!.draft.legId = planningIds.other;
  plan.draft = plan.plan!.draft;
  plan.catalog!.legs.push({ id: planningIds.other, name: "Hulk" });
  plan.readiness.overall = "verified_plan";
  Object.values(plan.readiness.dimensions).forEach((d) => {
    d.state = "verified_plan";
    d.reasons = [];
  });
  transport.search = `view=map&bookingId=${planningIds.booking}&season=2027&leg=${planningIds.leg}`;
  transport.get.mockImplementation(async (path: string) => {
    if (path === "/routes") return { travelLegs: plan.catalog!.legs };
    if (path.endsWith("/leg-operations")) {
      const o = operationsFixture(planningIds.booking);
      o.assignment = {
        state: "loaded",
        data: {
          assignedLeg: {
            id: leg === "Angel" ? planningIds.leg : planningIds.other,
            name: leg,
            archived: false,
          },
          assignmentSource: "manual",
          suggestion: null,
        },
      };
      o.planning = { state: "loaded", data: plan };
      return o;
    }
    throw new Error(`Unexpected ${path}`);
  });
  transport.fetch.mockImplementation(
    async (path: string, options?: RequestInit) => {
      if (path.endsWith("/operating-plan"))
        return { ok: true, json: async () => plan };
      if (path === "/operating-plans/commit") {
        const body = JSON.parse(String(options?.body));
        expect(body.bookingIds).toEqual([planningIds.booking]);
        leg = "Hulk";
        plan.plan!.committed = plan.plan!.draft;
        plan.plan!.revision++;
        return {
          ok: true,
          json: async () => ({
            receiptId: "receipt",
            value: [plan.plan],
            affectedBookingIds: [planningIds.booking],
            idempotent: false,
          }),
        };
      }
      throw new Error(`Unexpected ${path}`);
    },
  );
  render(<SchedulePage />);
  await screen.findByRole("heading", { name: "Leg & Operations" });
  expect(
    within(screen.getByRole("region", { name: "Leg & Operations" })).getByText(
      "Angel",
      { selector: "span" },
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Manager operations" }),
  ).toHaveAttribute(
    "href",
    `/manager/operations?bookingId=${planningIds.booking}&season=2027&leg=${planningIds.leg}`,
  );
  const toggle = screen.getByText("Operating plan · verified plan");
  fireEvent.click(toggle);
  const commit = await screen.findByRole("button", {
    name: "Commit verified plan",
    hidden: true,
  });
  fireEvent.click(commit);
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("region", { name: "Leg & Operations" }),
      ).getByText("Hulk", { selector: "span" }),
    ).toBeInTheDocument(),
  );
  expect(screen.getByText("Angelo")).toBeInTheDocument();
  expect(screen.getByText("Map remains available")).toBeInTheDocument();
  expect(
    transport.fetch.mock.calls.filter(([p]) => p === "/operating-plans/commit"),
  ).toHaveLength(1);
  expect(screen.getByText(/Booking: confirmed/)).toBeInTheDocument();
});
it("planning failure preserves history, equipment and navigation without verified readiness", async () => {
  transport.get.mockImplementation(async () => ({
    ...operationsFixture(planningIds.booking),
    planning: { state: "unavailable", message: "Planning source unavailable" },
  }));
  render(
    <BookingLegOperationsCard
      bookingId={planningIds.booking}
      role="owner"
      client={ownerOperationsClient}
    />,
  );
  await screen.findByText("Planning source unavailable");
  expect(screen.getByText("Angelo")).toBeInTheDocument();
  expect(
    screen.getByText("Paintball trailer has an overlapping reservation."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "View schedule & map" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Commit verified plan" }),
  ).not.toBeInTheDocument();
});
