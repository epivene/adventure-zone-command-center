import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createActivityAction = vi.hoisted(() => vi.fn());
const editActivityAction = vi.hoisted(() => vi.fn());
const listActivityRevisionsAction = vi.hoisted(() => vi.fn());

vi.mock("@/actions/activities", () => ({
  createActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
}));

import {
  CallQueueWorkspace,
  type CallQueueItem,
} from "@/components/today/call-queue-workspace";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
  createActivityAction.mockReset();
  editActivityAction.mockReset();
  listActivityRevisionsAction.mockReset();
});

const followUps: CallQueueItem[] = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: "20000000-0000-4000-8000-000000000001",
    bookingId: "30000000-0000-4000-8000-000000000001",
    bookingName: "Sarah's Spring Event",
    contactName: "Sarah Miller",
    organizationName: "Miller Events",
    bookingStatus: "pending_contract",
    routeLeg: { id: "40000000-0000-4000-8000-000000000001", name: "North route", color: "#ea580c" },
    lastContactedAt: new Date("2026-08-08T15:00:00.000Z"),
    kind: "call",
    dueAt: new Date("2026-08-12T15:00:00.000Z"),
    status: "due",
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    organizationId: "10000000-0000-4000-8000-000000000002",
    contactId: "20000000-0000-4000-8000-000000000002",
    bookingId: "30000000-0000-4000-8000-000000000002",
    bookingName: "Tom's Fall Festival",
    contactName: "Tom Erickson",
    organizationName: "Erickson Family Fun",
    bookingStatus: "interested",
    routeLeg: { id: "40000000-0000-4000-8000-000000000002", name: "West route", color: "#2563eb" },
    lastContactedAt: null,
    kind: "call",
    dueAt: new Date("2026-08-13T15:00:00.000Z"),
    status: "due",
  },
  {
    id: "60000000-0000-4000-8000-000000000003",
    organizationId: null,
    contactId: "20000000-0000-4000-8000-000000000003",
    bookingId: null,
    bookingName: "Lee Carter",
    contactName: "Lee Carter",
    organizationName: null,
    bookingStatus: null,
    routeLeg: null,
    lastContactedAt: null,
    kind: "call",
    dueAt: new Date("2026-08-14T15:00:00.000Z"),
    status: "due",
  },
];

function workspace(name: string) {
  return {
    context: {
      contact: { id: "contact", firstName: name.split(" ")[0], lastName: name.split(" ")[1] },
      organization: null,
      booking: null,
      followUp: null,
    },
  };
}

function workspaceRenderer(data: any, onComplete: (input: unknown) => Promise<any>): ReactNode {
  const name = `${data.context.contact.firstName} ${data.context.contact.lastName}`;
  return (
    <section>
      <h2>{name}</h2>
      <button onClick={() => void onComplete({ followUpId: data.followUpId })} type="button">
        Complete {name}
      </button>
    </section>
  );
}

function startFocus() {
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
}

describe("CallQueueWorkspace", () => {
  it("shows one compact next task and does not load the full workspace before Start", () => {
    const loadWorkspace = vi.fn(() => Promise.resolve(workspace("Sarah Miller")));

    render(
      <CallQueueWorkspace
        followUps={[followUps[0]]}
        loadWorkspace={loadWorkspace}
        renderWorkspace={workspaceRenderer}
      />,
    );

    expect(screen.getByText("Next up")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sarah Miller" })).toBeVisible();
    expect(screen.getByText("1 task remaining")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start" })).toBeVisible();
    expect(screen.queryByTestId("selected-call-workspace")).not.toBeInTheDocument();
    expect(loadWorkspace).not.toHaveBeenCalled();
  });

  it("enters focus mode on Start and hides the full queue", async () => {
    render(
      <CallQueueWorkspace
        followUps={followUps}
        loadWorkspace={(followUp) => Promise.resolve(workspace(followUp.contactName ?? followUp.bookingName))}
        renderWorkspace={workspaceRenderer}
      />,
    );

    startFocus();

    expect(screen.getByRole("button", { name: "Back to Today" })).toBeVisible();
    expect(screen.getByText("3 remaining")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Calls to make" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Sarah Miller" })).toBeVisible();
  });

  it("enters focus mode when Today links to the next task anchor", async () => {
    window.history.replaceState(null, "", "#today-next-task");
    render(
      <CallQueueWorkspace
        followUps={followUps}
        loadWorkspace={(followUp) => Promise.resolve(workspace(followUp.contactName ?? followUp.bookingName))}
        renderWorkspace={workspaceRenderer}
      />,
    );

    expect(screen.getByRole("button", { name: "Back to Today" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Sarah Miller" })).toBeVisible();
  });

  it("keeps the active task visible while loading another caller after completion", async () => {
    let resolveTom!: (value: any) => void;
    const loadWorkspace = vi.fn((followUp: CallQueueItem) =>
      followUp.contactName === "Tom Erickson"
        ? new Promise((resolve) => { resolveTom = resolve; })
        : Promise.resolve(workspace("Sarah Miller")),
    );

    render(
      <CallQueueWorkspace
        completeCall={vi.fn().mockResolvedValue({ ok: true })}
        followUps={followUps}
        loadWorkspace={loadWorkspace}
        refreshToday={vi.fn().mockResolvedValue({ followUps: followUps.slice(1), followUpTotal: 2 })}
        renderWorkspace={workspaceRenderer}
      />,
    );
    startFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Complete Sarah Miller" }));
    expect(screen.getByText("Loading caller…")).toBeVisible();
    resolveTom(workspace("Tom Erickson"));
    expect(await screen.findByRole("heading", { name: "Tom Erickson" })).toBeVisible();
  });

  it("shows caller context on the compact next-task card", () => {
    render(
      <CallQueueWorkspace
        followUps={followUps}
        loadWorkspace={() => new Promise(() => {})}
        remainingCount={7}
        renderWorkspace={workspaceRenderer}
      />,
    );

    expect(screen.getByText("7 tasks remaining")).toBeVisible();
    expect(screen.getByText("Miller Events")).toBeVisible();
    expect(screen.getByText("Pending contract")).toBeVisible();
    expect(screen.getByText("North route")).toBeVisible();
    expect(screen.getByText(/Last contact/)).toBeVisible();
  });

  it("offers retry plus the standalone workspace when loading fails in focus mode", async () => {
    const loadWorkspace = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(workspace("Sarah Miller"));
    render(
      <CallQueueWorkspace
        followUps={followUps}
        loadWorkspace={loadWorkspace}
        renderWorkspace={workspaceRenderer}
      />,
    );
    startFocus();

    expect(await screen.findByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open standalone workspace" })).toHaveAttribute(
      "href",
      `/calls/new?contactId=${followUps[0].contactId}&bookingId=${followUps[0].bookingId}&followUpId=${followUps[0].id}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Sarah Miller" })).toBeVisible();
  });

  it("selects the original next caller after completion and a reordered refetch", async () => {
    const refreshed = [followUps[2], followUps[1]];
    const refreshToday = vi.fn().mockResolvedValue({ followUps: refreshed, followUpTotal: 2 });
    render(
      <CallQueueWorkspace
        completeCall={vi.fn().mockResolvedValue({ ok: true })}
        followUps={followUps}
        initialFollowUpId={followUps[0].id}
        loadWorkspace={(followUp) => Promise.resolve(workspace(followUp.contactName ?? followUp.bookingName))}
        refreshToday={refreshToday}
        renderWorkspace={workspaceRenderer}
      />,
    );
    startFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Complete Sarah Miller" }));

    expect(await screen.findByRole("heading", { name: "Tom Erickson" })).toBeVisible();
    expect(refreshToday).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 remaining")).toBeVisible();
  });

  it("renders the real compact workspace with activity controls and history after Start", async () => {
    const activityId = "70000000-0000-4000-8000-000000000001";
    createActivityAction.mockResolvedValue({
      ok: true,
      activity: {
        id: "70000000-0000-4000-8000-000000000002",
        organizationId: followUps[0].organizationId,
        contactId: followUps[0].contactId,
        bookingId: followUps[0].bookingId,
        kind: "note",
        body: "New queue note",
        occurredAt: new Date("2026-08-12T16:00:00.000Z"),
        createdAt: new Date("2026-08-12T16:00:00.000Z"),
        updatedAt: new Date("2026-08-12T16:00:00.000Z"),
        revisionCount: 0,
      },
    });
    editActivityAction.mockResolvedValue({
      ok: true,
      activity: {
        id: activityId,
        organizationId: followUps[0].organizationId,
        contactId: followUps[0].contactId,
        bookingId: followUps[0].bookingId,
        kind: "call",
        body: "Corrected prior conversation",
        occurredAt: new Date("2026-08-08T15:00:00.000Z"),
        createdAt: new Date("2026-08-08T15:00:00.000Z"),
        updatedAt: new Date("2026-08-12T16:00:00.000Z"),
        revisionCount: 2,
      },
    });
    listActivityRevisionsAction.mockResolvedValue({
      ok: true,
      revisions: [{
        id: "revision-1",
        activityId,
        priorBody: "Earlier wording",
        replacementBody: "Prior conversation",
        reason: "Corrected wording",
        createdAt: new Date("2026-08-09T15:00:00.000Z"),
      }],
      nextPage: null,
    });
    render(
      <CallQueueWorkspace
        followUps={followUps}
        loadWorkspace={() => Promise.resolve({
          activityParent: { bookingId: followUps[0].bookingId },
          context: {
            organization: {
              id: followUps[0].organizationId,
              name: "Miller Events",
              lastResort: false,
              lastResortReason: null,
            },
            contact: {
              id: followUps[0].contactId,
              firstName: "Sarah",
              lastName: "Miller",
              phone: null,
              email: "sarah@example.test",
              city: "Fargo",
              region: "ND",
            },
            booking: {
              id: followUps[0].bookingId,
              name: "Sarah's Spring Event",
              city: "Fargo",
              region: "ND",
              status: "pending_contract",
              startsAt: null,
            },
            followUp: {
              id: followUps[0].id,
              kind: "call",
              dueAt: followUps[0].dueAt,
            },
          },
          contextSummary: {
            bookingStatusLabel: "Pending contract",
            travelLeg: followUps[0].routeLeg,
            lastContactedAt: followUps[0].lastContactedAt,
          },
          defaultScriptKind: "follow_up",
          operations: null,
          phones: [],
          scriptPrompts: ["Reference the previous conversation"],
          timeline: [{
            id: activityId,
            kind: "call",
            body: "Prior conversation",
            occurredAt: "2026-08-08T15:00:00.000Z",
            createdAt: "2026-08-08T15:00:00.000Z",
            updatedAt: "2026-08-08T15:00:00.000Z",
            revisionCount: 1,
          }],
        })}
      />,
    );
    startFocus();

    expect(await screen.findByRole("heading", { name: "Call Workspace" })).toBeVisible();
    fireEvent.click(screen.getByText("Recent history"));
    expect(screen.getByRole("button", { name: "Add activity" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit activity" })).toBeVisible();
    expect(screen.getByText("Prior conversation")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View edit history (1)" }));
    await waitFor(() => expect(listActivityRevisionsAction).toHaveBeenCalledWith(activityId));
    expect(await screen.findByText("Earlier wording")).toBeVisible();
  });

  it("decrements a stale refreshed total when the completed follow-up is still returned", async () => {
    const refreshToday = vi.fn().mockResolvedValue({ followUps, followUpTotal: 3 });
    render(
      <CallQueueWorkspace
        completeCall={vi.fn().mockResolvedValue({ ok: true })}
        followUps={followUps}
        loadWorkspace={(followUp) => Promise.resolve(workspace(followUp.contactName ?? followUp.bookingName))}
        refreshToday={refreshToday}
        renderWorkspace={workspaceRenderer}
      />,
    );
    startFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Complete Sarah Miller" }));

    expect(await screen.findByText("2 remaining")).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Sarah Miller" })).not.toBeInTheDocument();
    });
  });
});