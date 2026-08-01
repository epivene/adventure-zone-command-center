// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ActImportReview } from "@/components/import/act-import-review";
import type {
  ActCsvRecord,
  ImportCategory,
  ImportPreview,
  ImportPreviewRow,
} from "@/features/import/act-types";

afterEach(cleanup);

const record: ActCsvRecord = {
  rowNumber: 2,
  recordId: "ACT-1",
  company: "Marias Fair",
  contact: "Avery Example",
  email: "avery@example.com",
  phone: "406-555-0101",
  city: "Shelby",
  region: "MT",
  validationErrors: [],
};

function row(
  category: ImportCategory,
  rowNumber: number,
): ImportPreviewRow {
  return {
    rowId: `row-${rowNumber}`,
    record: { ...record, rowNumber },
    category,
    matchReason: category === "new" ? "none" : "email",
    localContactId: category === "new" ? null : "contact-1",
    localContact: null,
    candidateContactIds: category === "conflict" ? ["one", "two"] : [],
    changes:
      category === "change"
        ? [{ field: "phone", before: "old", after: record.phone }]
        : [],
    messages:
      category === "conflict" ? ["Multiple contacts matched."] : [],
  };
}

const preview: ImportPreview = {
  runId: "run-1",
  sourceFileName: "act.csv",
  rows: [
    row("new", 2),
    row("change", 3),
    row("duplicate", 4),
    row("conflict", 5),
    row("error", 6),
  ],
  summary: { new: 1, change: 1, duplicate: 1, conflict: 1, error: 1 },
};

describe("ActImportReview", () => {
  it("approves all safe new and change rows but excludes duplicates and conflicts", async () => {
    const user = userEvent.setup();
    render(<ActImportReview initialPreview={preview} />);

    await user.click(
      screen.getByRole("button", { name: "Approve All Safe Changes" }),
    );

    expect(screen.getByText("2 rows selected for apply")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Approve CSV row 2" }),
    ).toBeChecked();
    await user.click(screen.getByRole("tab", { name: /Conflicts/ }));
    expect(
      screen.getByRole("checkbox", { name: "Approve CSV row 5" }),
    ).toBeDisabled();
  });

  it("uses named tabs with category counts and exposes row errors for review", async () => {
    const user = userEvent.setup();
    render(<ActImportReview initialPreview={preview} />);

    expect(screen.getByRole("tab", { name: "New 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "Errors 1" }));

    expect(screen.getByText("Avery Example")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Approve CSV row 6" }),
    ).toBeDisabled();
  });
});
