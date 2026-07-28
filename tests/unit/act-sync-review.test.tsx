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
const queueToken = "11111111-1111-4111-8111-111111111111";

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

function pendingOperation(value: SyncComparisonRow) {
  return {
    rowId: value.rowId,
    status: "pending" as const,
    decision: null,
    localContactId: value.localContactId,
    actRecordId: value.actRecordId,
    error: null,
    retryable: true,
    updatedAt: new Date("2026-07-27T12:00:00.000Z"),
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
  operations: rows.map(pendingOperation),
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
  activeQueueToken: null,
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
    operations: newRows.map(pendingOperation),
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

  it("unlocks the page with sanitized copy when testing the connection rejects", async () => {
    const user = userEvent.setup();
    const testConnection = vi.fn(async () => {
      throw new Error("socket secret and raw upstream body");
    });
    render(
      <ActSyncReview
        configured
        initialPreview={preview}
        maskedDatabase="••••3125"
        testConnectionAction={testConnection}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByText(
        "The Act! connection test was interrupted. Try again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeEnabled();
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

  it("shows the exact number of rows eligible for category approval", async () => {
    const user = userEvent.setup();
    const exactRows = [
      row("new_in_act", "eligible"),
      {
        ...row("new_in_act", "skip-only"),
        allowedDecisions: ["skip" as const],
      },
    ];
    const exactPreview: StoredSyncPreview = {
      ...preview,
      rows: exactRows,
      operations: exactRows.map(pendingOperation),
      summary: { ...preview.summary, new_in_act: 2 },
    };
    render(
      <ActSyncReview
        configured
        initialPreview={exactPreview}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Approve only New in Act! (1)",
      }),
    );

    expect(screen.getByText("1 row approved")).toBeVisible();
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
    expect(
      await screen.findByText("1 approved change completed."),
    ).toBeVisible();
  });

  it("hydrates completed, skipped, failed, applying, and pending rows on reload", async () => {
    const user = userEvent.setup();
    const reloadRows = [
      row("new_in_act", "completed"),
      row("new_in_act", "skipped"),
      row("new_in_act", "failed"),
      row("new_in_act", "applying"),
      row("new_in_act", "pending"),
    ];
    const reloadPreview: StoredSyncPreview = {
      ...preview,
      status: "partial",
      rows: reloadRows,
      operations: [
        {
          ...pendingOperation(reloadRows[0]!),
          status: "completed",
          decision: "pull",
        },
        {
          ...pendingOperation(reloadRows[1]!),
          status: "skipped",
          decision: "skip",
        },
        {
          ...pendingOperation(reloadRows[2]!),
          status: "failed",
          decision: "pull",
          error: "Try this contact again.",
        },
        {
          ...pendingOperation(reloadRows[3]!),
          status: "applying",
          decision: "pull",
        },
        pendingOperation(reloadRows[4]!),
      ],
      summary: { ...preview.summary, new_in_act: 5 },
    };
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
        initialPreview={reloadPreview}
        maskedDatabase="••••3125"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Decision for completed" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Decision for skipped" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Decision for applying" }),
    ).toBeDisabled();
    expect(screen.getByText("Try this contact again.")).toBeVisible();
    expect(
      screen.getByText(
        "This contact is still being reconciled. Refresh before retrying.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve only New in Act! (1)" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry failed contacts" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Retry failed contacts" }),
    );

    expect(apply).toHaveBeenCalledWith("run-1", [
      { rowId: "failed", decision: "pull" },
    ]);
  });

  it("hydrates an approved multi-candidate link target on reload", async () => {
    const user = userEvent.setup();
    const linkRow = {
      ...row("possible_match", "link-row"),
      localContactId: null,
      candidateLocalContactIds: ["local-first", "local-second"],
    };
    const reloadPreview: StoredSyncPreview = {
      ...preview,
      status: "previewed",
      rows: [linkRow],
      operations: [
        {
          ...pendingOperation(linkRow),
          status: "approved",
          decision: "link",
          localContactId: "local-second",
        },
      ],
      summary: {
        ...preview.summary,
        new_in_act: 0,
        changed_in_app: 0,
        changed_in_both: 0,
        possible_match: 1,
      },
    };
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
        initialPreview={reloadPreview}
        maskedDatabase="••••3125"
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Possible matches 1" }));

    expect(
      screen.getByRole("combobox", { name: "Local contact to link" }),
    ).toHaveValue("local-second");
    await user.click(
      screen.getByRole("button", { name: "Retry remaining contacts" }),
    );
    expect(apply).toHaveBeenCalledWith("run-1", [
      {
        rowId: "link-row",
        decision: "link",
        localContactId: "local-second",
      },
    ]);
  });

  it("keeps a non-retryable stored failure locked after reload", () => {
    const failedRow = row("new_in_act", "manual-review");
    const reloadPreview: StoredSyncPreview = {
      ...preview,
      status: "failed",
      rows: [failedRow],
      operations: [
        {
          ...pendingOperation(failedRow),
          status: "failed",
          decision: "pull",
          error: "Create a new preview.",
          retryable: false,
        },
      ],
      summary: {
        ...preview.summary,
        new_in_act: 1,
        changed_in_app: 0,
        changed_in_both: 0,
      },
    };

    render(
      <ActSyncReview
        configured
        initialPreview={reloadPreview}
        maskedDatabase="••••3125"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Decision for manual-review" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Retry/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Create a new preview.")).toBeVisible();
  });

  it("clears a durable recovery queue before approving another category", async () => {
    const user = userEvent.setup();
    const queueRows = [
      row("new_in_act", "old-approved"),
      row("new_in_app", "new-selection"),
    ];
    const queuePreview: StoredSyncPreview = {
      ...preview,
      activeQueueToken: queueToken,
      status: "previewed",
      rows: queueRows,
      operations: [
        {
          ...pendingOperation(queueRows[0]!),
          status: "approved",
          decision: "pull",
        },
        pendingOperation(queueRows[1]!),
      ],
      summary: {
        ...preview.summary,
        new_in_act: 1,
        new_in_app: 1,
        changed_in_app: 0,
        changed_in_both: 0,
      },
    };
    const clearStaged = vi.fn(async (runId: string) => ({
      ok: true as const,
      runId,
    }));

    render(
      <ActSyncReview
        applyAction={vi.fn()}
        clearStagedAction={clearStaged}
        configured
        initialPreview={queuePreview}
        maskedDatabase="••••3125"
      />,
    );
    await user.click(screen.getByRole("tab", { name: "New in app 1" }));
    await user.click(
      screen.getByRole("button", { name: "Approve only New in app (1)" }),
    );

    expect(clearStaged).toHaveBeenCalledWith("run-1", queueToken);
    expect(screen.getByText("1 row approved")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Decision for new-selection" }),
    ).toHaveValue("push");
  });

  it("applies approved contacts in 50-row batches and reports completion", async () => {
    const user = userEvent.setup();
    const largePreview = previewWithNewActRows(51);
    const stage = vi.fn(
      async (
        runId: string,
        decisions: readonly SyncApplyDecision[],
        context: {
          replaceExisting: boolean;
          queueToken: string | null;
        },
      ) => {
        void decisions;
        void context;
        return {
          ok: true as const,
          runId,
          queueToken,
        };
      },
    );
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
      receivedQueueToken?: string,
    ) => {
      void receivedQueueToken;
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
        stageDecisionsAction={stage}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));

    expect(stage).toHaveBeenCalledTimes(2);
    expect(stage.mock.calls[0]?.[1]).toHaveLength(50);
    expect(stage.mock.calls[1]?.[1]).toHaveLength(1);
    expect(stage.mock.calls[0]?.[2]).toEqual({
      replaceExisting: true,
      queueToken: null,
    });
    expect(stage.mock.calls[1]?.[2]).toEqual({
      replaceExisting: false,
      queueToken,
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]![1]).toHaveLength(50);
    expect(apply.mock.calls[1]![1]).toHaveLength(1);
    expect(apply.mock.calls[0]![2]).toBe(queueToken);
    expect(apply.mock.calls[1]![2]).toBe(queueToken);
    expect(await screen.findByText("51 contacts imported.")).toBeVisible();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("reports skipped contacts separately with singular completion grammar", async () => {
    const user = userEvent.setup();
    const twoRows = previewWithNewActRows(2);
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision, index) => ({
          rowId: decision.rowId,
          status: index === 0 ? "completed" as const : "skipped" as const,
          error: null,
        })),
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={twoRows}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (2)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 2 approved" }));

    expect(
      await screen.findByText("1 contact imported · 1 skipped."),
    ).toBeVisible();
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

  it("labels a non-retryable failure as requiring a new preview", async () => {
    const user = userEvent.setup();
    const oneRow = previewWithNewActRows(1);
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision) => ({
          rowId: decision.rowId,
          status: "failed" as const,
          error: "Create a new preview.",
          retryable: false,
        })),
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={oneRow}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (1)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 1 approved" }));

    expect(
      await screen.findByText("0 imported · 1 needs a new preview."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Retry/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Needs attention: New in Act! (1).")).toBeVisible();
  });

  it("continues past a non-retryable row reported with an interruption", async () => {
    const user = userEvent.setup();
    const twoRows = previewWithNewActRows(2);
    let interrupted = true;
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => {
      if (interrupted) {
        interrupted = false;
        return {
          ok: false as const,
          error: "Act! rejected the shared account credentials.",
          interruptedRow: {
            rowId: decisions[0]!.rowId,
            status: "failed" as const,
            error: "Act! rejected the shared account credentials.",
            retryable: false,
          },
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
        initialPreview={twoRows}
        maskedDatabase="••••3125"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve only New in Act! (2)" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply 2 approved" }));

    expect(
      await screen.findAllByText(
        "Act! rejected the shared account credentials.",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Retry remaining contacts" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Retry remaining contacts" }),
    );
    expect(apply.mock.calls[1]?.[1]).toEqual([
      { rowId: "new-act-2", decision: "pull" },
    ]);
  });

  it("names every category containing failed rows", async () => {
    const user = userEvent.setup();
    const mixedRows = [
      row("new_in_act", "failed-act"),
      row("changed_in_app", "failed-app"),
      row("new_in_app", "pending-app"),
    ];
    const mixedPreview: StoredSyncPreview = {
      ...preview,
      rows: mixedRows,
      operations: mixedRows.map(pendingOperation),
      summary: {
        ...preview.summary,
        new_in_act: 1,
        new_in_app: 1,
        changed_in_app: 1,
        changed_in_both: 0,
      },
    };
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision) => ({
          rowId: decision.rowId,
          status: "failed" as const,
          error: "Try this contact again.",
        })),
      },
    }));
    render(
      <ActSyncReview
        applyAction={apply}
        configured
        initialPreview={mixedPreview}
        maskedDatabase="••••3125"
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Decision for failed-act" }),
      "pull",
    );
    await user.click(screen.getByRole("tab", { name: "Changed in app 1" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Decision for failed-app" }),
      "push",
    );
    await user.click(screen.getByRole("button", { name: "Apply 2 approved" }));

    expect(
      await screen.findByText(
        "Needs attention: New in Act! (1), Changed in app (1).",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "New in app 1" }));
    await user.click(
      screen.getByRole("button", { name: "Approve only New in app (1)" }),
    );
    expect(
      screen.getByText(
        "Needs attention: New in Act! (1), Changed in app (1).",
      ),
    ).toBeVisible();
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
    expect(routerRefresh).not.toHaveBeenCalled();

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
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let call = 0;
    const apply = vi.fn(async (
      runId: string,
      decisions: readonly SyncApplyDecision[],
    ) => {
      call += 1;
      if (call === 2) await secondGate;
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
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Importing 50 of 51…")).toBeVisible();
    const categoryTab = screen.getByRole("tab", { name: "Changed in both 0" });
    expect(categoryTab).toBeDisabled();
    expect(categoryTab).toHaveClass("disabled:opacity-60");
    expect(
      screen.getByRole("combobox", { name: "Decision for new-act-1" }),
    ).toBeDisabled();
    const approve = screen.getByRole("button", {
      name: "Approve only New in Act! (1)",
    });
    expect(approve).toBeDisabled();
    expect(approve).toHaveClass("disabled:opacity-60");
    expect(
      screen.getByRole("button", { name: "Apply 1 approved" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();

    await act(async () => {
      releaseSecond();
    });
    expect(await screen.findByText("51 contacts imported.")).toBeVisible();
  });
});
