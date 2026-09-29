import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import type { DocumentResult } from "@/features/assistant-workspace/types";
import { DocumentResults } from "./DocumentResults";
import { WorkspacePanel } from "./WorkspacePanel";
import { mockNativeDialog } from "@/test/native-dialog";

let restoreDialog: () => void;
beforeEach(() => {
  restoreDialog = mockNativeDialog();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreDialog();
});
it("labels reused readings while preserving visual review and the protected-file action", () => {
  const open = vi.fn();
  render(
    <DocumentResults
      onOpen={open}
      items={[
        {
          id: "r",
          retrievedAt: "2026-09-25T01:00:00Z",
          data: {
            view: "document_reading",
            documentId: "doc",
            sourceLabel: "Business document",
            eventYear: 2027,
            version: "hash",
            complete: false,
            totalPages: 2,
            missingPages: [2],
            cacheHit: true,
            extractedAt: "2026-09-25T00:00:00Z",
          },
        },
      ]}
    />,
  );
  expect(screen.getByText(/Reused reading/)).toBeTruthy();
  expect(screen.getByText(/Visual review needed · Pages 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open protected file" }));
  expect(open).toHaveBeenCalledWith("doc");
});
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
  fireEvent.click(screen.getByRole("button", { name: "View full report" }));
  expect(
    screen
      .getByRole("link", { name: "City fair listing" })
      .getAttribute("href"),
  ).toBe("https://city.example/fair");
  expect(
    within(screen.getByRole("dialog")).getByText("Research incomplete"),
  ).toBeTruthy();
  expect(screen.getByText("Consulted sources")).toBeTruthy();
});

function research(text: string): DocumentResult {
  return {
    id: "research",
    retrievedAt: "2026-09-26T10:00:00Z",
    data: {
      view: "public_research",
      query: "Find fair contacts",
      model: "chosen-model",
      complete: true,
      parts: [
        {
          text,
          citations: [
            {
              title: "Fair source",
              url: "https://fair.example/source",
              startIndex: 0,
              endIndex: 8,
            },
          ],
        },
        {
          text: "Final finding from the second source.",
          citations: [
            {
              title: "Second source",
              url: "https://town.example/calendar",
              startIndex: 0,
              endIndex: 13,
            },
          ],
        },
      ],
      consultedSources: [
        { title: "Consulted calendar", url: "https://fair.example/calendar" },
      ],
      warnings: ["Verify the event date before outreach."],
    },
  };
}

it("keeps a long research preview compact and opens all report text and sources in a wider dialog", () => {
  const text = `## Fair contacts\n\n**Confirmed listing.**\n\n| Event | Contact |\n| --- | --- |\n| County Fair | [Office](https://fair.example/contact) |\n\n${"Detailed evidence. ".repeat(120)}\n\nFinal report paragraph.`;
  render(<DocumentResults onOpen={vi.fn()} items={[research(text)]} />);
  expect(screen.queryByText("Final report paragraph.")).toBeNull();
  expect(
    screen.queryByText("Final finding from the second source."),
  ).toBeNull();
  expect(screen.getByRole("region", { name: "Research excerpt" })).toHaveClass(
    "max-h-48",
    "overflow-y-auto",
  );
  expect(screen.getByText("Confirmed listing.").tagName).toBe("STRONG");

  fireEvent.click(screen.getByRole("button", { name: "View full report" }));
  const report = screen.getByRole("dialog", { name: "Public research report" });
  expect(report).toHaveClass("max-w-5xl", "overflow-hidden");
  expect(
    within(report).getByRole("region", { name: "Full research report" }),
  ).toHaveClass("overflow-y-auto", "min-h-0");
  expect(within(report).getByRole("table")).toBeTruthy();
  expect(
    within(report).getByRole("columnheader", { name: "Contact" }),
  ).toBeTruthy();
  expect(within(report).getByText("Final report paragraph.")).toBeTruthy();
  expect(
    within(report).getByText("Final finding from the second source."),
  ).toBeTruthy();
  expect(within(report).getByRole("link", { name: "Office" })).toHaveAttribute(
    "href",
    "https://fair.example/contact",
  );
  expect(
    within(report).getByRole("link", { name: "Fair source" }),
  ).toHaveAttribute("href", "https://fair.example/source");
  expect(
    within(report).getByRole("link", { name: "Second source" }),
  ).toHaveAttribute("href", "https://town.example/calendar");
  expect(
    within(report).getByRole("link", { name: "Consulted calendar" }),
  ).toHaveAttribute("href", "https://fair.example/calendar");
  expect(
    within(report).getByText("Verify the event date before outreach."),
  ).toBeTruthy();
  fireEvent.click(within(report).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps unsafe citation and consulted source URLs inert and contains long source labels", () => {
  const item = research(
    '[Unsafe markdown](javascript:alert%281%29)\n\n<img src="https://tracking.example/pixel">',
  );
  if (item.data.view !== "public_research") throw new Error("fixture type");
  item.data.parts[0].citations.push({
    title: "Unsafe citation",
    url: "javascript:alert(1)",
    startIndex: 0,
    endIndex: 5,
  });
  item.data.consultedSources.push({
    title: "Unsafe consulted source",
    url: "data:text/html,<script>alert(1)</script>",
  });
  const longUrl = `https://fair.example/${"long-path".repeat(90)}`;
  item.data.consultedSources.push({ title: longUrl, url: longUrl });
  const { container } = render(
    <DocumentResults onOpen={vi.fn()} items={[item]} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View full report" }));
  const report = screen.getByRole("dialog");
  expect(within(report).getByText("Unsafe markdown").closest("a")).toBeNull();
  expect(within(report).getByText("Unsafe citation").closest("a")).toBeNull();
  expect(
    within(report).getByText("Unsafe consulted source").closest("a"),
  ).toBeNull();
  expect(container.querySelector("img,script,iframe")).toBeNull();
  expect(report.querySelector("img,script,iframe")).toBeNull();
  const source = within(report).getByRole("link", { name: "fair.example" });
  expect(source).toHaveAttribute("href", longUrl);
  expect(source).toHaveAttribute("rel", "noopener noreferrer");
  expect(source).toHaveClass("break-words");
});

it("opens research in the native top layer above a compact workspace sheet and closes only the report", () => {
  const changed = vi.fn();
  const shown = vi.spyOn(HTMLDialogElement.prototype, "showModal");
  render(
    <WorkspacePanel
      title="Drafts and actions"
      open
      inline={false}
      onOpenChange={changed}
    >
      <DocumentResults
        onOpen={vi.fn()}
        items={[research("Verified report text.")]}
      />
    </WorkspacePanel>,
  );
  const parent = screen.getByRole("dialog", { name: "Drafts and actions" });
  const trigger = within(parent).getByRole("button", {
    name: "View full report",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const report = screen.getByRole("dialog", { name: "Public research report" });
  expect(report).toBeInstanceOf(HTMLDialogElement);
  expect(report).toHaveAttribute("open");
  expect(parent.contains(report)).toBe(true);
  expect(shown.mock.contexts).toContain(parent);
  expect(shown.mock.contexts).toContain(report);

  fireEvent(report, new Event("cancel", { cancelable: true, bubbles: true }));
  expect(
    screen.queryByRole("dialog", { name: "Public research report" }),
  ).toBeNull();
  expect(parent).toHaveAttribute("open");
  expect(changed).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();

  fireEvent.click(trigger);
  const reopened = screen.getByRole("dialog", {
    name: "Public research report",
  });
  fireEvent.click(within(reopened).getByRole("button", { name: "Close" }));
  expect(parent).toHaveAttribute("open");
  expect(changed).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
});

it("shows the original research time and explicit reuse in the preview and full report", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-26T13:00:00Z"));
  const item = research("The cited original report.");
  if (item.data.view !== "public_research") throw new Error("fixture type");
  item.retrievedAt = "2026-09-26T12:30:00Z";
  item.data.savedResearch = {
    id: "33333333-3333-4333-8333-333333333333",
    generatedAt: "2026-09-26T10:00:00Z",
    expiresAt: "2026-09-27T10:00:00Z",
    reusedAt: "2026-09-26T12:30:00Z",
    stale: false,
  };
  const { container } = render(
    <DocumentResults items={[item]} onOpen={vi.fn()} />,
  );
  expect(screen.getByText(/Saved research ·/)).toBeTruthy();
  expect(
    screen.getByText("Reused saved report; no new web search was made."),
  ).toBeTruthy();
  expect(container.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-09-26T10:00:00Z",
  );
  expect(screen.queryByText(/older than 24 hours/)).toBeNull();
  expect(screen.queryByText(/Saved snapshot/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View full report" }));
  const dialog = screen.getByRole("dialog", { name: "Public research report" });
  expect(
    within(dialog).getByText(
      "Reused saved report; no new web search was made.",
    ),
  ).toBeTruthy();
  expect(dialog.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-09-26T10:00:00Z",
  );
  expect(
    within(dialog).getByRole("link", { name: "Fair source" }),
  ).toBeTruthy();
});

it("warns when saved research has expired even if its last server snapshot was fresh", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-28T10:00:00Z"));
  const item = research("Historical research.");
  if (item.data.view !== "public_research") throw new Error("fixture type");
  item.data.savedResearch = {
    id: "33333333-3333-4333-8333-333333333333",
    generatedAt: "2026-09-26T10:00:00Z",
    expiresAt: "2026-09-27T10:00:00Z",
    reusedAt: null,
    stale: false,
  };
  render(<DocumentResults items={[item]} onOpen={vi.fn()} />);
  expect(screen.getByText(/This research is older than 24 hours/)).toBeTruthy();
  expect(screen.queryByText(/no new web search was made/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View full report" }));
  expect(
    within(screen.getByRole("dialog")).getByText(
      /This research is older than 24 hours/,
    ),
  ).toBeTruthy();
});
