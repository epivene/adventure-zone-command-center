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
it("shows public research with cited and consulted sources and incomplete evidence", () => {
  render(
    <DocumentResults
      onOpen={vi.fn()}
      items={[
        {
          id: "research",
          retrievedAt: null,
          data: {
            view: "public_research",
            query: "City fair dates",
            model: "chosen-model",
            complete: false,
            parts: [
              {
                text: "The public listing is historical.",
                citations: [
                  {
                    url: "https://city.example/fair",
                    title: "City fair listing",
                    startIndex: 0,
                    endIndex: 31,
                  },
                ],
              },
            ],
            consultedSources: [
              { url: "https://city.example/events", title: "Events calendar" },
            ],
            warnings: ["Confirm current event dates."],
          },
        } as any,
      ]}
    />,
  );
  expect(
    screen
      .getByRole("link", { name: "City fair listing" })
      .getAttribute("href"),
  ).toBe("https://city.example/fair");
  expect(screen.getByText("Research incomplete")).toBeTruthy();
  expect(screen.getByText("Consulted sources")).toBeTruthy();
});
