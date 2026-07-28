// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { ActSyncReview } from "@/components/act-sync/act-sync-review";
import type { StoredSyncPreview } from "@/features/act-sync/sync-repository";
import type {
  SyncComparisonCategory,
  SyncComparisonRow,
} from "@/features/act-sync/sync-comparison";
import type { SyncApplyDecision } from "@/features/act-sync/sync-service";

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

function previewWithNewActRows(count: number): StoredSyncPreview {
  const newRows = Array.from({ length: count }, (_, index) =>
    row("new_in_act", `new-act-${index + 1}`),
  );
  return {
    ...preview,
    rows: newRows,
    summary: {
      new_in_act: count,
      new_in_app: 0,
      changed_in_act: 0,
      changed_in_app: 0,
      changed_in_both: 0,
      possible_match: 0,
      already_matched: 0,
      missing_from_act: 0,
      error: 0,
    },
  };
}

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
    const openPreview = vi.fn();
    const apply = vi.fn();
    render(
      <ActSyncReview
        configured
        createPreviewAction={createPreview}
        applyAction={apply}
        initialPreview={null}
        maskedDatabase="••••3125"
        openPreview={openPreview}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sync with Act!" }));

    expect(createPreview).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(openPreview).toHaveBeenCalledWith("run-2");
  });

  it("shows a recoverable error when preview creation unexpectedly fails", async () => {
    const user = userEvent.setup();
    const createPreview = vi.fn(async () => {
      throw new Error("network disconnected");
    });
    render(
      <ActSyncReview
        configured
        createPreviewAction={createPreview}
        initialPreview={null}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sync with Act!" }));

    expect(
      screen.getByText(
        "The Act! review could not be prepared. Your contacts were not changed. Try again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sync with Act!" }),
    ).toBeEnabled();
  });

  it("bulk-approves only the category being viewed and clears hidden choices", async () => {
    const user = userEvent.setup();
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision) => ({
          rowId: decision.rowId,
          status: "completed" as const,
          error: null,
        })),
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

    await user.click(screen.getByRole("tab", { name: "Changed in app 1" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Decision for changed-app" }),
      "push",
    );
    await user.click(screen.getByRole("tab", { name: "New in Act! 1" }));
    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (1)" }),
    );
    expect(screen.getByText("1 row approved")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Apply 1 approved" }));

    expect(apply).toHaveBeenCalledWith("run-1", [
      { rowId: "new-act", decision: "pull" },
    ]);
  });

  it("does not offer bulk approval for a conflict category", async () => {
    const user = userEvent.setup();
    render(
      <ActSyncReview
        configured
        initialPreview={preview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Changed in both 1" }));

    expect(
      screen.queryByRole("button", { name: /Approve only/ }),
    ).not.toBeInTheDocument();
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

  it("applies approved contacts in 50-row batches and reports completion", async () => {
    const user = userEvent.setup();
    const largePreview = previewWithNewActRows(51);
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision) => ({
          rowId: decision.rowId,
          status: "completed" as const,
          error: null,
        })),
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={largePreview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]![1]).toHaveLength(50);
    expect(apply.mock.calls[1]![1]).toHaveLength(1);
    expect(await screen.findByText("51 contacts imported.")).toBeVisible();
  });

  it("continues after a contact failure and retries only the failed contact", async () => {
    const user = userEvent.setup();
    const largePreview = previewWithNewActRows(51);
    let shouldFail = true;
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision) => ({
          rowId: decision.rowId,
          status:
            shouldFail && decision.rowId === "new-act-2"
              ? "failed" as const
              : "completed" as const,
          error:
            shouldFail && decision.rowId === "new-act-2"
              ? "Try this contact again."
              : null,
        })),
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={largePreview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));

    expect(apply).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("50 imported · 1 needs retry.")).toBeVisible();
    expect(screen.getByText("Try this contact again.")).toBeVisible();

    shouldFail = false;
    await user.click(
      screen.getByRole("button", { name: "Retry failed contacts" }),
    );

    expect(apply).toHaveBeenCalledTimes(3);
    expect(apply.mock.calls[2]![1]).toEqual([
      { rowId: "new-act-2", decision: "pull" },
    ]);
  });

  it("retries only unfinished contacts after a staged interruption", async () => {
    const user = userEvent.setup();
    const largePreview = previewWithNewActRows(51);
    let interrupted = true;
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => {
      if (interrupted && decisions[0]?.rowId === "new-act-51") {
        return {
          ok: false as const,
          error: "The connection was interrupted.",
        };
      }
      return {
        ok: true as const,
        result: {
          runId,
          rows: decisions.map((decision) => ({
            rowId: decision.rowId,
            status: "completed" as const,
            error: null,
          })),
        },
      };
    });
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={largePreview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]![1]).toHaveLength(50);
    expect(apply.mock.calls[1]![1]).toEqual([
      { rowId: "new-act-51", decision: "pull" },
    ]);
    expect(await screen.findByText("The connection was interrupted.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry remaining contacts" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Decision for new-act-1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Decision for new-act-51" }),
    ).toHaveValue("pull");
    expect(
      screen.getByRole("button", { name: "Approve only New in Act! (1)" }),
    ).toBeVisible();

    interrupted = false;
    await user.click(
      screen.getByRole("button", { name: "Retry remaining contacts" }),
    );

    expect(apply).toHaveBeenCalledTimes(3);
    expect(apply.mock.calls[2]![1]).toEqual([
      { rowId: "new-act-51", decision: "pull" },
    ]);
    expect(
      screen.getByRole("combobox", { name: "Decision for new-act-51" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Approve only New in Act!/ }),
    ).not.toBeInTheDocument();
  });

  it("disables review controls and shows live progress while importing", async () => {
    const user = userEvent.setup();
    const largePreview = previewWithNewActRows(51);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => {
      await gate;
      return {
        ok: true as const,
        result: {
          runId,
          rows: decisions.map((decision) => ({
            rowId: decision.rowId,
            status: "completed" as const,
            error: null,
          })),
        },
      };
    });
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={largePreview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());

    expect(screen.getByText("Importing 0 of 51…")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Changed in both 0" })).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Decision for new-act-1" }),
    ).toBeDisabled();

    await act(async () => {
      release();
    });
    expect(await screen.findByText("51 contacts imported.")).toBeVisible();
  });
});
