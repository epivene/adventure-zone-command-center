// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

import { ActSyncReview } from "@/components/act-sync/act-sync-review";
import type { StoredSyncPreview } from "@/features/act-sync/sync-repository";
import type {
  SyncComparisonCategory,
  SyncComparisonRow,
} from "@/features/act-sync/sync-comparison";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const emptySnapshot = {
  firstName: "Avery",
  lastName: "Example",
  organizationName: "Marias Fair",
  jobTitle: null,
  email: "avery@example.com",
  phone: "406-555-0101",
  address1: null,
  address2: null,
  city: "Shelby",
  region: "MT",
  postalCode: null,
};

function row(
  category: SyncComparisonCategory,
  rowId: string,
): SyncComparisonRow {
  const decisions = {
    new_in_act: ["pull", "skip"],
    new_in_app: ["push", "skip"],
    changed_in_act: ["pull", "skip"],
    changed_in_app: ["push", "skip"],
    changed_in_both: ["keep_act", "keep_app", "skip"],
    possible_match: ["link", "keep_separate", "skip"],
    already_matched: [],
    missing_from_act: ["skip"],
    error: ["skip"],
  } as const;
  return {
    rowId,
    category,
    matchReason: category === "new_in_app" ? "none" : "email",
    localContactId: category === "new_in_act" ? null : `local-${rowId}`,
    actRecordId: category === "new_in_app" ? null : `act-${rowId}`,
    candidateLocalContactIds:
      category === "new_in_act" ? [] : [`local-${rowId}`],
    candidateActRecordIds:
      category === "new_in_app" ? [] : [`act-${rowId}`],
    baseSnapshot: category === "new_in_act" ? null : emptySnapshot,
    localSnapshot: category === "new_in_act" ? null : emptySnapshot,
    actSnapshot: category === "new_in_app" ? null : emptySnapshot,
    actEditedAt: "2026-07-27T12:00:00.000Z",
    allowedDecisions: [...decisions[category]],
    messages:
      category === "changed_in_both"
        ? ["Both Command Center and Act! changed."]
        : [],
  };
}

const rows = [
  row("new_in_act", "new-act"),
  row("changed_in_app", "changed-app"),
  row("changed_in_both", "conflict"),
];

const preview: StoredSyncPreview = {
  id: "run-1",
  status: "previewed",
  rows,
  summary: {
    new_in_act: 1,
    new_in_app: 0,
    changed_in_act: 0,
    changed_in_app: 1,
    changed_in_both: 1,
    possible_match: 0,
    already_matched: 0,
    missing_from_act: 0,
    error: 0,
  },
  startedAt: new Date("2026-07-27T12:00:00.000Z"),
  completedAt: null,
};

describe("ActSyncReview", () => {
  it("shows only masked Act connection details", () => {
    render(
      <ActSyncReview
        configured
        initialPreview={null}
        maskedDatabase="••••3125"
      />,
    );

    expect(
      screen.getByText("Connected settings found · Database ••••3125"),
    ).toBeVisible();
    expect(screen.queryByText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
  });

  it("creates a preview without applying changes", async () => {
    const user = userEvent.setup();
    const createPreview = vi.fn(async () => ({
      ok: true as const,
      runId: "run-2",
    }));
    const apply = vi.fn();
    render(
      <ActSyncReview
        configured
        createPreviewAction={createPreview}
        applyAction={apply}
        initialPreview={null}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sync with Act!" }));

    expect(createPreview).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith(
      "/settings/act-sync?runId=run-2",
    );
  });

  it("bulk-approves only safe default decisions before apply", async () => {
    const user = userEvent.setup();
    const apply = vi.fn(async () => ({
      ok: true as const,
      result: {
        runId: "run-1",
        rows: [
          { rowId: "new-act", status: "completed" as const, error: null },
          {
            rowId: "changed-app",
            status: "completed" as const,
            error: null,
          },
        ],
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={preview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve safe defaults" }),
    );
    expect(screen.getByText("2 rows approved")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Apply 2 approved" }));

    expect(apply).toHaveBeenCalledWith("run-1", [
      { rowId: "new-act", decision: "pull" },
      { rowId: "changed-app", decision: "push" },
    ]);
  });

  it("requires an explicit conflict choice", async () => {
    const user = userEvent.setup();
    const apply = vi.fn(async () => ({
      ok: true as const,
      result: {
        runId: "run-1",
        rows: [
          { rowId: "conflict", status: "completed" as const, error: null },
        ],
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={preview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("tab", { name: "Changed in both 1" }),
    );
    expect(
      screen.getByRole("combobox", { name: "Decision for conflict" }),
    ).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Apply 0 approved" }),
    ).toBeDisabled();

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Decision for conflict",
      }),
      "keep_app",
    );
    await user.click(screen.getByRole("button", { name: "Apply 1 approved" }));

    expect(apply).toHaveBeenCalledWith("run-1", [
      { rowId: "conflict", decision: "keep_app" },
    ]);
  });
});
