import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Planner } from "@/features/outreach-planner/outreach-api";
import type { CallListFollowUp } from "@/features/today/leg-call-list";
import { LegCallList } from "./leg-call-list";

const mocks = vi.hoisted(() => ({ getPlanner: vi.fn(), apiGet: vi.fn() }));
vi.mock("@/features/outreach-planner/outreach-api", () => ({ getPlanner: mocks.getPlanner }));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet }));
const now = new Date("2026-10-02T17:00:00Z");
const reminders: CallListFollowUp[] = [{ id: "call-1", organizationId: "org-1", contactId: "contact-1", bookingId: "booking-1", bookingName: "Fair callback", kind: "callback", dueAt: "2026-10-01T17:00:00Z", routeLeg: { id: "dave", name: "Dave" } }];
const emptyPlanner: Planner = { enabled: true, candidates: [], openings: [], legs: [{ id: "dave", name: "Dave", active: true }], packages: [], researchTasks: [] };
function review() {
  return {
    context: { organization: { lastResort: false, lastResortReason: null as string | null }, contact: { id: "contact-1", firstName: "Pat", lastName: "Smith" } },
    phones: [{ id: "phone-1", number: "555-0100", extension: "42", doNotCallAt: null as string | null }],
    operations: null,
  };
}
beforeEach(() => {
  sessionStorage.clear();
  mocks.getPlanner.mockResolvedValue(emptyPlanner);
  mocks.apiGet.mockResolvedValue(review());
});
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); });
describe("LegCallList", () => {
  it("keeps profiles available without offering a disabled call workspace", async () => {
    render(<LegCallList followUps={reminders} now={now} callingEnabled={false} />);
    await screen.findByText("Fair callback");
    expect(screen.queryByRole("button", { name: "Review contact and phone" })).toBeNull();
    expect(screen.getByRole("link", { name: "Event profile" })).toBeTruthy();
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });
  it("shows requested calls and loads live contact data only when asked", async () => {
    render(<LegCallList followUps={reminders} now={now} />);
    await screen.findByText("Fair callback");
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open call and save outcome" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review contact and phone" }));
    await screen.findByText("Phone: 555-0100 ext. 42");
    expect(screen.getByRole("link", { name: "Open call and save outcome" }).getAttribute("href")).toContain("followUpId=call-1");
    expect(mocks.apiGet.mock.calls[0][0]).toContain("bookingId=booking-1");
    expect(screen.getByRole("link", { name: "Event profile" }).getAttribute("href")).toContain("/profiles/org-1?");
  });
  it.each(["last-resort", "do-not-call", "no-phone"] as const)("withholds the call action for %s", async (reason) => {
    const data = review();
    if (reason === "last-resort") { data.context.organization.lastResort = true; data.context.organization.lastResortReason = "Do not contact"; }
    if (reason === "do-not-call") data.phones[0].doNotCallAt = now.toISOString();
    if (reason === "no-phone") data.phones = [];
    mocks.apiGet.mockResolvedValue(data);
    render(<LegCallList followUps={reminders} now={now} />);
    await screen.findByText("Fair callback");
    fireEvent.click(screen.getByRole("button", { name: "Review contact and phone" }));
    await screen.findByText("Recorded contact: Pat Smith");
    expect(screen.queryByRole("link", { name: "Open call and save outcome" })).toBeNull();
    if (reason === "last-resort") expect(screen.getByText(/Last Resort — do not call/)).toBeTruthy();
    else expect(screen.getByText(/No callable phone/)).toBeTruthy();
  });
  it("fails closed when the live contact check fails and supports retry", async () => {
    mocks.apiGet.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(review());
    render(<LegCallList followUps={reminders} now={now} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review contact and phone" }));
    await screen.findByRole("button", { name: "Retry contact check" });
    expect(screen.queryByRole("link", { name: "Open call and save outcome" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry contact check" }));
    await screen.findByRole("link", { name: "Open call and save outcome" });
  });
  it("keeps due calls available when planner loading fails and warns about partial reminder coverage", async () => {
    mocks.getPlanner.mockRejectedValue(new Error("offline"));
    render(<LegCallList followUps={reminders} followUpTotal={200} now={now} />);
    await screen.findByText(/Route prospects could not load/);
    expect(screen.getByText("Fair callback")).toBeTruthy();
    expect(screen.getByText(/1 loaded reminders of 200/)).toBeTruthy();
    mocks.getPlanner.mockResolvedValue(emptyPlanner);
    fireEvent.click(screen.getByRole("button", { name: "Refresh call list" }));
    await waitFor(() => expect(screen.queryByText(/Route prospects could not load/)).toBeNull());
  });
  it("preserves the selected leg across navigation and makes unknown callback seasons explicit", async () => {
    const first = render(<LegCallList followUps={reminders} now={now} />);
    fireEvent.change(screen.getByLabelText("Leg"), { target: { value: "dave" } });
    first.unmount();
    render(<LegCallList followUps={reminders} now={now} />);
    expect((screen.getByLabelText("Leg") as HTMLSelectElement).value).toBe("dave");
    expect(screen.getByText(/Season needs review/)).toBeTruthy();
  });
  it("marks initial email prospects for review even when the contact has a phone", async () => {
    mocks.getPlanner.mockResolvedValue({
      ...emptyPlanner,
      openings: [{ id: "gap", title: "Spring gap", status: "open", eventYear: 2027, startsOn: "2027-04-01", endsOn: "2027-04-10", legId: "dave", quantities: { az: 1 } }],
      packages: [{ id: "az", name: "Adventure Zone" }],
      candidates: [{
        id: "candidate", openingId: "gap", opportunityId: "event", organizationId: "org-1", bookingId: "booking-1", organizationName: "Spring Fair", eventYear: 2027, tier: "strong", manualRank: 0,
        outreach: { state: "ready", dueAt: null, reason: "Initial outreach" }, portfolio: { state: "first_choice", reason: "First choice" }, capacity: { status: "needs_review", reasons: [] }, capacityDisplayReasons: ["Crew not set"],
        sources: { choices: [], reviewReasons: [], protectedReason: null, manualNextActions: [] },
      }],
    });
    render(<LegCallList followUps={[]} now={now} />);
    await screen.findByText("Spring Fair");
    expect(screen.getByText(/Send the initial email/)).toBeTruthy();
    expect(screen.getByText(/Suggested packages: Adventure Zone × 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review contact and phone" }));
    await screen.findByText("Phone: 555-0100 ext. 42");
    expect(screen.queryByRole("link", { name: "Open call and save outcome" })).toBeNull();
  });
});
