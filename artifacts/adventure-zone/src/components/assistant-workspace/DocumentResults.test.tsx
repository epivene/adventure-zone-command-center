import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentResults } from "./DocumentResults";
it("shows incomplete page evidence and opens the selected protected document", () => {
  const open = vi.fn();
  render(
    <DocumentResults
      onOpen={open}
      items={[
        {
          id: "call",
          retrievedAt: "2026-09-24T00:00:00Z",
          data: {
            view: "document_comparison",
            complete: false,
            sources: [
              {
                id: "doc",
                title: "Sample insurance",
                category: "coi",
                organizationIds: ["customer"],
                eventYear: 2027,
                version: "hash",
                complete: false,
                totalPages: 2,
                missingPages: [2],
              },
            ],
          },
        },
      ]}
    />,
  );
  expect(screen.getByText(/Unreadable pages: 2/)).toBeTruthy();
  expect(
    screen.getByText(
      /does not verify signatures, payments or insurance coverage/,
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Sample insurance" }),
  );
  expect(open).toHaveBeenCalledWith("doc");
});
