import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CallQueueWorkspace,
  type CallQueueItem,
} from "@/components/today/call-queue-workspace";

const followUp: CallQueueItem = {
  id: "60000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  bookingId: "30000000-0000-4000-8000-000000000001",
  bookingName: "County Fair",
  contactName: "Jamie Smith",
  organizationName: "County Fair Board",
  bookingStatus: "interested",
  routeLeg: null,
  lastContactedAt: null,
  kind: "call",
  dueAt: new Date("2026-08-25T15:00:00.000Z"),
  status: "due",
};

afterEach(() => cleanup());

describe("Today outreach actions", () => {
  it("offers email and web-contact actions from the compact queue card", () => {
    render(
      <CallQueueWorkspace
        followUps={[followUp]}
        loadWorkspace={() => new Promise(() => {})}
        renderWorkspace={() => null}
      />,
    );

    const expectedHref =
      `/profiles/${followUp.organizationId}` +
      `?contactId=${followUp.contactId}` +
      `&bookingId=${followUp.bookingId}` +
      `&followUpId=${followUp.id}` +
      `&action=follow-up`;

    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", expectedHref);
    expect(screen.getByRole("link", { name: "Web contact" })).toHaveAttribute("href", expectedHref);
  });
});
