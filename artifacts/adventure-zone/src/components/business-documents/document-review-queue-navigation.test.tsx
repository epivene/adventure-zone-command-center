// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentReviewQueue } from "./document-review-queue";
import type { BusinessDocumentReviewItem } from "@/lib/business-documents-api";

afterEach(cleanup);

function reviewItem(index: number, name = `Document ${String(index).padStart(2, "0")}`): BusinessDocumentReviewItem {
  return {
    id: `review-${index}`,
    documentId: `document-${index}`,
    kind: "classification",
    state: "pending",
    proposals: {},
    reasonCodes: ["classification_unconfirmed"],
    lastErrorCode: null,
    deferredUntil: null,
    displayName: name,
    originalFilename: `${name}.pdf`,
    category: "other",
    createdAt: `2026-09-${String(Math.min(index, 28)).padStart(2, "0")}T12:00:00.000Z`,
  };
}

function apiWith(items: BusinessDocumentReviewItem[]) {
  return {
    reviewItems: vi.fn().mockResolvedValue({ items }),
    searchProfiles: vi.fn().mockResolvedValue([]),
    reviewAction: vi.fn().mockResolvedValue({ ok: true }),
    open: vi.fn().mockResolvedValue("https://example.com/file"),
  };
}

describe("DocumentReviewQueue", () => {
  it("paginates a large review queue instead of rendering every document at once", async () => {
    const api = apiWith(Array.from({ length: 26 }, (_, index) => reviewItem(index + 1)));

    render(<DocumentReviewQueue api={api} />);

    expect(await screen.findByText("Showing 1–25 of 26 documents")).toBeVisible();
    expect(screen.getByText("Document 26")).toBeVisible();
    expect(screen.queryByText("Document 01")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Showing 26–26 of 26 documents")).toBeVisible();
    expect(screen.getByText("Document 01")).toBeVisible();
    expect(screen.queryByText("Document 26")).not.toBeInTheDocument();
  });

  it("filters and sorts the queue before pagination", async () => {
    const api = apiWith([
      reviewItem(1, "Zebra Contract"),
      reviewItem(2, "Alpha Contract"),
      reviewItem(3, "County Fair Photo"),
    ]);

    render(<DocumentReviewQueue api={api} />);
    await screen.findByText("Zebra Contract");

    fireEvent.change(screen.getByRole("searchbox", { name: "Find documents to sort" }), {
      target: { value: "contract" },
    });
    fireEvent.change(screen.getByLabelText("Sort review documents"), {
      target: { value: "name_asc" },
    });

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Alpha Contract", "Zebra Contract"]);
    expect(screen.queryByText("County Fair Photo")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1–2 of 2 documents")).toBeVisible();
  });

  it("explains an empty profile search instead of silently showing nothing", async () => {
    const api = apiWith([reviewItem(1, "Caribou Contract")]);
    render(<DocumentReviewQueue api={api} />);
    await screen.findByText("Caribou Contract");

    fireEvent.change(screen.getByLabelText("Profile search for Caribou Contract"), {
      target: { value: "Missing Profile" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    expect(await screen.findByText("No profiles found. Try fewer words or search by city.")).toBeVisible();
    await waitFor(() => expect(api.searchProfiles).toHaveBeenCalledWith("Missing Profile"));
  });
});
