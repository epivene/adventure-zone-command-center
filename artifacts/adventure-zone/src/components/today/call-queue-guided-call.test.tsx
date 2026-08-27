import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
}));

import {
  CallQueueWorkspace,
  type CallQueueItem,
} from "@/components/today/call-queue-workspace";

const followUps: CallQueueItem[] = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: "20000000-0000-4000-8000-000000000001",
    bookingId: "30000000-0000-4000-8000-000000000001",
    bookingName: "Spring Event",
    contactName: "Sarah Miller",
    organizationName: "Miller Events",
    bookingStatus: "interested",
    routeLeg: null,
    lastContactedAt: null,
    kind: "call",
    dueAt: new Date("2026-08-19T15:00:00.000Z"),
    status: "due",
    callPhone: {
      id: "90000000-0000-4000-8000-000000000001",
      number: "701-555-0199",
      extension: null,
      type: "mobile",
    },
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    organizationId: "10000000-0000-4000-8000-000000000002",
    contactId: "20000000-0000-4000-8000-000000000002",
    bookingId: "30000000-0000-4000-8000-000000000002",
    bookingName: "Fall Festival",
    contactName: "Tom Erickson",
    organizationName: "Erickson Family Fun",
    bookingStatus: "new_lead",
    routeLeg: null,
    lastContactedAt: null,
    kind: "call",
    dueAt: new Date("2026-08-19T16:00:00.000Z"),
    status: "due",
    callPhone: {
      id: "90000000-0000-4000-8000-000000000002",
      number: "701-555-0112",
      extension: "4",
      type: "office",
    },
  },
];

function workspace(name: string) {
  return {
    context: {
      contact: {
        id: "contact",
        firstName: name.split(" ")[0],
        lastName: name.split(" ")[1],
      },
      organization: null,
      booking: null,
      followUp: null,
    },
  };
}

function renderWorkspace(data: any): ReactNode {
  return <h2>{`${data.context.contact.firstName} ${data.context.contact.lastName}`}</h2>;
}

afterEach(cleanup);

describe("Today guided call action", () => {
  it("opens the selected caller in focus mode without completing the call", async () => {
    const loadWorkspace = vi.fn((followUp: CallQueueItem) =>
      Promise.resolve(workspace(followUp.contactName ?? followUp.bookingName)),
    );
    const completeCall = vi.fn();

    render(
      <CallQueueWorkspace
        completeCall={completeCall}
        followUps={followUps}
        loadWorkspace={loadWorkspace}
        renderWorkspace={renderWorkspace}
      />,
    );

    expect(screen.getByRole("heading", { name: "Sarah Miller" })).toBeVisible();
    expect(loadWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start call" }));

    expect(await screen.findByRole("heading", { name: "Sarah Miller" })).toBeVisible();
    expect(loadWorkspace).toHaveBeenCalledWith(followUps[0]);
    expect(completeCall).not.toHaveBeenCalled();
  });
});
