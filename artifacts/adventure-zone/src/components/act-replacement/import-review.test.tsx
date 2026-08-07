import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportReview } from "./import-review";

afterEach(cleanup);

describe("ImportReview", () => {
  it("shows safe counts, grouped issues, and only sanitized record summaries", () => {
    render(
      <ImportReview
        safeOperationCount={42}
        reviewRequiredCount={3}
        review={{
          page: 1,
          pageSize: 25,
          total: 3,
          manifestDigest: "a".repeat(64),
          rows: [
            {
              sourceRecordId: "private-source-id",
              sourceVersionId: "private-version-id",
              state: "awaiting_review",
              issueCodes: ["ambiguous_match"],
              operationKeys: [],
              streamType: "contact",
              display: { name: "Ada Lovelace", email: "ada@example.com" },
            },
            {
              sourceRecordId: "second-private-id",
              sourceVersionId: "second-private-version",
              state: "unsupported",
              issueCodes: ["unsupported_field", "ambiguous_match"],
              operationKeys: [],
              streamType: "company",
              display: { name: "Analytical Engines" },
            },
          ],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImport={() => {}}
      />,
    );

    expect(screen.getByText("42 safe operations ready")).toBeInTheDocument();
    expect(screen.getByText("3 records need your review")).toBeInTheDocument();
    expect(screen.getByText("Issue groups on this page")).toBeInTheDocument();
    expect(screen.getByText("Ambiguous match (2)")).toBeInTheDocument();
    expect(screen.getByText("Unsupported field (1)")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/private-source-id/i)).not.toBeInTheDocument();
  });

  it("submits search and pages through durable review results", () => {
    const onSearch = vi.fn();
    const onPageChange = vi.fn();
    render(
      <ImportReview
        safeOperationCount={1}
        reviewRequiredCount={26}
        review={{
          page: 1,
          pageSize: 25,
          total: 26,
          manifestDigest: "a".repeat(64),
          rows: [],
        }}
        onSearch={onSearch}
        onPageChange={onPageChange}
        onImport={() => {}}
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search review records" }),
      {
        target: { value: "Ada" },
      },
    );
    fireEvent.submit(screen.getByRole("search"));
    expect(onSearch).toHaveBeenCalledWith("Ada");

    fireEvent.click(screen.getByRole("button", { name: "Next review page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
