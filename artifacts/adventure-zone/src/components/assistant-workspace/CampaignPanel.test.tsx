import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CampaignPanel } from "./CampaignPanel";
it("restores saved progress and blocked members and requests the next page through the conversation", () => {
  const request = vi.fn();
  render(
    <CampaignPanel
      batches={[
        {
          id: "batch",
          title: "Summer fairs",
          eventYear: 2027,
          criteria: "Colorado",
          revision: 3,
          cursor: 2,
          members: [
            { organizationId: "a" },
            { organizationId: "b" },
            { organizationId: "c" },
          ],
          draftLinks: { a: "draft" },
        },
      ]}
      reviews={[
        {
          batchId: "batch",
          member: { organizationId: "b" },
          profileName: "Blocked fair",
          eligible: false,
          reasons: ["CONTACT_NOT_ACTIVE"],
          cautions: [],
          checkedAt: "2026-09-24",
        },
      ]}
      selectedBatchId="batch"
      onRequest={request}
      busy={false}
    />,
  );
  expect(screen.getByText(/2 of 3 leads loaded in pages/)).toBeTruthy();
  expect(screen.getByText(/CONTACT NOT ACTIVE/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next 10 leads" }));
  expect(request.mock.calls[0][0]).toContain("batch");
  expect(request.mock.calls[0][0]).toContain("revision 3");
  expect(screen.queryByRole("button", { name: /send all/i })).toBeNull();
});
