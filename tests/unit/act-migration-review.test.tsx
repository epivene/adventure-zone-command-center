// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { ActMigrationReview } from "@/components/act-migration/act-migration-review";
import { AppShell } from "@/components/navigation/app-shell";
import type { StoredMigrationWorkspace } from "@/features/act-migration/runtime";
import type { SnapshotProgress } from "@/features/act-migration/snapshot-repository";
import type {
  StoredMigrationPreviewPage,
  StoredMigrationProposal,
} from "@/features/act-migration/preview-repository";

const runId = "11111111-1111-4111-8111-111111111111";
const requestKey = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const unavailableCandidateId = "44444444-4444-4444-8444-444444444444";
const streamTypes = [
  "company",
  "contact",
  "opportunity",
  "group",
  "company_contact",
  "opportunity_company",
  "opportunity_contact",
  "group_contact",
] as const;

function progress(
  overrides: Partial<SnapshotProgress> = {},
): SnapshotProgress {
  return {
    runId,
    status: "snapshotting",
    completedCheckpoints: 1,
    totalCheckpoints: 8,
    stagedRecords: 25,
    failedCheckpoints: 0,
    retryable: false,
    retryAfter: null,
    streams: streamTypes.map((streamType, index) => ({
      streamType,
      completedCheckpoints: index === 0 ? 1 : 0,
      totalCheckpoints: 1,
      stagedRecords: index + 1,
      failedCheckpoints: 0,
      retryable: false,
      retryAfter: null,
      errorCode: null,
    })),
    interruption: null,
    ...overrides,
  };
}

function proposal(
  overrides: Partial<StoredMigrationProposal> = {},
): StoredMigrationProposal {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    proposalKey: "contact:ACT-100",
    state: "possible_duplicate",
    reviewState: "pending",
    targetEntityType: "contact",
    sourceRecordKeys: ["contact:ACT-100"],
    candidateLocalIds: [candidateId],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    matchReason: "same normalized email",
    issueCode: "ambiguous_person_match",
    dependencyProposalKeys: [],
    displaySnapshot: {
      name: "Safe preview name",
      city: "Shelby",
    },
    decision: null,
    decisionReason: null,
    chosenLocalEntityId: null,
    primarySourceId: null,
    decidedBy: null,
    decidedAt: null,
    candidateChoices: [{
      id: candidateId,
      label: "Local Avery Example",
      available: true,
    }],
    primarySourceChoices: [{
      id: "ACT-100",
      label: "ACT-100",
      available: true,
    }],
    ...overrides,
  };
}

function preview(
  overrides: Partial<StoredMigrationPreviewPage> = {},
): StoredMigrationPreviewPage {
  return {
    runId,
    rows: [proposal()],
    report: {
      sourceCounts: {
        company: 1_814,
        contact: 25,
        opportunity: 4,
        group: 2,
      },
      relationshipCounts: {
        company_contact: 20,
        opportunity_company: 3,
        opportunity_contact: 4,
        group_contact: 5,
      },
      previewCounts: {
        new: 5,
        matched_unchanged: 6,
        change: 7,
        new_relationship: 8,
        possible_duplicate: 9,
        needs_review: 10,
        ignored: 11,
        error: 12,
      },
      placesWithoutPeople: 13,
      multiPlacePeople: 14,
      opportunitiesWithoutPlace: 15,
      opportunitiesWithoutPerson: 16,
      duplicateSourceIdConflicts: 17,
      incompleteCheckpoints: 18,
      failedCheckpoints: 19,
      sourceDigest: "safe-source-digest",
      proposalDigest: "safe-proposal-digest",
      complete: true,
    },
    page: 3,
    pageSize: 50,
    total: 181,
    entityCounts: {
      organization: 70,
      contact: 71,
      organization_contact: 72,
      booking: 73,
      booking_contact: 74,
      calling_list: 75,
      calling_list_member: 76,
    },
    stateCounts: {
      new: 80,
      matched_unchanged: 81,
      change: 82,
      new_relationship: 83,
      possible_duplicate: 84,
      needs_review: 85,
      ignored: 86,
      error: 87,
    },
    ...overrides,
  };
}

function workspace(
  progressValue = progress(),
  previewValue: StoredMigrationPreviewPage | null = null,
): StoredMigrationWorkspace {
  return { progress: progressValue, preview: previewValue };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    maskedDatabase: "••••3125",
    query: { page: 1, pageSize: 50 },
    workspace: workspace(),
    requestKeyFactory: () => requestKey,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("Act migration review workspace", () => {
  it("shows the exact warning, connection mask, and all eight streams separately", () => {
    render(<ActMigrationReview {...props()} />);

    expect(
      screen.getByText(
        "Preview only — no Command Center or Act! records are changed",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Database ••••3125/)).toBeVisible();
    for (const label of [
      "Companies",
      "Contacts",
      "Opportunities",
      "Groups",
      "Company–Contact relationships",
      "Opportunity–Company relationships",
      "Opportunity–Contact relationships",
      "Group–Contact relationships",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeVisible();
    }
    expect(screen.queryByRole("button", { name: /apply/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import/i }))
      .not.toBeInTheDocument();
  });

  it("starts with a UUID and auto-continues serially from returned progress until changed is false", async () => {
    const startAction = vi.fn(async () => ({
      ok: true as const,
      changed: true,
      runId,
      progress: progress({ completedCheckpoints: 1 }),
    }));
    let active = 0;
    let maximumActive = 0;
    const resolvers: Array<(value: {
      ok: true;
      changed: boolean;
      runId: string;
      progress: SnapshotProgress;
    }) => void> = [];
    const continueAction = vi.fn(() => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return new Promise<{
        ok: true;
        changed: boolean;
        runId: string;
        progress: SnapshotProgress;
      }>((resolve) => {
        resolvers.push((value) => {
          active -= 1;
          resolve(value);
        });
      });
    });
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({
          workspace: null,
          startAction,
          continueAction,
        })}
      />,
    );

    const click = user.click(
      screen.getByRole("button", { name: "Start preview snapshot" }),
    );
    await waitFor(() => expect(continueAction).toHaveBeenCalledTimes(1));
    expect(startAction).toHaveBeenCalledWith(requestKey);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(maximumActive).toBe(1);

    await act(async () => {
      resolvers[0]!({
        ok: true,
        changed: true,
        runId,
        progress: progress({ completedCheckpoints: 2 }),
      });
    });
    await waitFor(() => expect(continueAction).toHaveBeenCalledTimes(2));
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(maximumActive).toBe(1);

    await act(async () => {
      resolvers[1]!({
        ok: true,
        changed: false,
        runId,
        progress: progress({ completedCheckpoints: 2 }),
      });
    });
    await click;

    expect(maximumActive).toBe(1);
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(router.replace).toHaveBeenCalledWith(
      `/settings/act-migration?runId=${runId}&page=1&pageSize=50`,
    );
    expect(router.refresh).not.toHaveBeenCalled();

    const check = user.click(
      screen.getByRole("button", { name: "Check again" }),
    );
    await waitFor(() => expect(continueAction).toHaveBeenCalledTimes(3));
    await act(async () => {
      resolvers[2]!({
        ok: true,
        changed: false,
        runId,
        progress: progress({ completedCheckpoints: 2 }),
      });
    });
    await check;
    expect(maximumActive).toBe(1);
    expect(router.replace).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("processes a completed start result under React StrictMode", async () => {
    const startAction = vi.fn(async () => ({
      ok: true as const,
      changed: false,
      runId,
      progress: progress(),
    }));
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ActMigrationReview
          {...props({ workspace: null, startAction })}
        />
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", {
      name: "Start preview snapshot",
    }));

    expect(startAction).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith(
      `/settings/act-migration?runId=${runId}&page=1&pageSize=50`,
    );
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("starts a fresh snapshot after a stored completed run", async () => {
    const completed = progress({
      status: "previewed",
      completedCheckpoints: 8,
    });
    const startAction = vi.fn(async () => ({
      ok: true as const,
      changed: false,
      runId: "99999999-9999-4999-8999-999999999999",
      progress: completed,
    }));
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({
          workspace: workspace(completed, preview()),
          startAction,
        })}
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "Start fresh preview snapshot",
    }));

    expect(startAction).toHaveBeenCalledWith(requestKey);
  });

  it("refreshes stored progress after an automatic continuation error", async () => {
    const startAction = vi.fn(async () => ({
      ok: true as const,
      changed: true,
      runId,
      progress: progress(),
    }));
    let resolveContinue!: (value: {
      ok: false;
      error: string;
      retryable: true;
      retryAfter: null;
    }) => void;
    const continueAction = vi.fn(() => new Promise<{
      ok: false;
      error: string;
      retryable: true;
      retryAfter: null;
    }>((resolve) => {
      resolveContinue = resolve;
    }));
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({ workspace: null, startAction, continueAction })}
      />,
    );

    const click = user.click(screen.getByRole("button", {
      name: "Start preview snapshot",
    }));

    await waitFor(() => expect(continueAction).toHaveBeenCalledOnce());
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      resolveContinue({
        ok: false,
        error: "Act! is temporarily unavailable.",
        retryable: true,
        retryAfter: null,
      });
    });
    await click;
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Act! is temporarily unavailable.",
    );
    expect(router.replace).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("uses an in-flight guard to reject synchronous double starts", async () => {
    let resolveStart!: (value: {
      ok: true;
      changed: false;
      runId: string;
      progress: SnapshotProgress;
    }) => void;
    const startAction = vi.fn(() => new Promise<{
      ok: true;
      changed: false;
      runId: string;
      progress: SnapshotProgress;
    }>((resolve) => {
      resolveStart = resolve;
    }));
    render(
      <ActMigrationReview
        {...props({ workspace: null, startAction })}
      />,
    );
    const start = screen.getByRole("button", {
      name: "Start preview snapshot",
    });

    start.click();
    start.click();
    expect(startAction).toHaveBeenCalledOnce();

    await act(async () => {
      resolveStart({
        ok: true,
        changed: false,
        runId,
        progress: progress(),
      });
    });
  });

  it("does not schedule continuation from a stale completion after unmount", async () => {
    let resolveStart!: (value: {
      ok: true;
      changed: true;
      runId: string;
      progress: SnapshotProgress;
    }) => void;
    const startAction = vi.fn(() => new Promise<{
      ok: true;
      changed: true;
      runId: string;
      progress: SnapshotProgress;
    }>((resolve) => {
      resolveStart = resolve;
    }));
    const continueAction = vi.fn();
    const view = render(
      <ActMigrationReview
        {...props({ workspace: null, startAction, continueAction })}
      />,
    );

    screen.getByRole("button", { name: "Start preview snapshot" }).click();
    view.unmount();
    await act(async () => {
      resolveStart({
        ok: true,
        changed: true,
        runId,
        progress: progress(),
      });
    });

    expect(continueAction).not.toHaveBeenCalled();
  });

  it("stops completed work and offers finalization only for a nonempty complete checkpoint set", async () => {
    const complete = progress({
      status: "snapshotting",
      completedCheckpoints: 8,
      totalCheckpoints: 8,
      failedCheckpoints: 0,
      interruption: null,
    });
    const first = render(
      <ActMigrationReview {...props({ workspace: workspace(complete) })} />,
    );

    expect(
      screen.getByRole("button", { name: "Finalize preview" }),
    ).toBeEnabled();

    first.unmount();
    render(
      <ActMigrationReview
        {...props({
          workspace: workspace(progress({
            completedCheckpoints: 0,
            totalCheckpoints: 0,
          })),
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Finalize preview" }))
      .not.toBeInTheDocument();
  });

  it("adopts an already-stored preview when finalization reports changed false", async () => {
    const storedPreview = preview({ page: 2, pageSize: 25 });
    const finalizeAction = vi.fn(async () => ({
      ok: true as const,
      changed: false,
      runId,
      preview: storedPreview,
    }));
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({
          finalizeAction,
          query: {
            page: 2,
            pageSize: 25,
            targetEntityType: "contact",
            state: "needs_review",
          },
          workspace: workspace(progress({
            completedCheckpoints: 8,
            totalCheckpoints: 8,
          })),
        })}
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "Finalize preview",
    }));

    expect(finalizeAction).toHaveBeenCalledWith({
      runId,
      query: {
        page: 2,
        pageSize: 25,
        targetEntityType: "contact",
        state: "needs_review",
      },
    });
    expect(
      screen.getByRole("heading", { name: "Stored preview proposals" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Finalize preview" }))
      .not.toBeInTheDocument();
  });

  it("uses the selected interruption for Resume eligibility and respects retryAfter", () => {
    const now = Date.parse("2030-01-01T12:00:00.000Z");
    const retryableInterruption = progress({
      retryable: false,
      retryAfter: null,
      failedCheckpoints: 1,
      interruption: {
        code: "rate_limited",
        retryable: true,
        retryAfter: new Date("2030-01-01T13:00:00.000Z"),
      },
    });
    const first = render(
      <ActMigrationReview
        {...props({
          now: () => now,
          workspace: workspace(retryableInterruption),
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    expect(screen.getByText(/Available after 2030-01-01T13:00:00.000Z/))
      .toBeVisible();

    first.rerender(
      <ActMigrationReview
        {...props({
          now: () => Date.parse("2030-01-01T14:00:00.000Z"),
          workspace: workspace(retryableInterruption),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();

    first.unmount();
    render(
      <ActMigrationReview
        {...props({
          now: () => now,
          workspace: workspace(progress({
            retryable: true,
            failedCheckpoints: 2,
            interruption: {
              code: "authentication_failed",
              retryable: false,
              retryAfter: null,
            },
          })),
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Resume" }))
      .not.toBeInTheDocument();
  });

  it("uses Resume only for manual retry and continues automatically only after its changed result", async () => {
    const retryProgress = progress({
      failedCheckpoints: 1,
      interruption: {
        code: "unavailable",
        retryable: true,
        retryAfter: null,
      },
    });
    const resumeAction = vi.fn(async () => ({
      ok: true as const,
      changed: true,
      runId,
      progress: progress({ completedCheckpoints: 2 }),
    }));
    const continueAction = vi.fn(async () => ({
      ok: true as const,
      changed: false,
      runId,
      progress: progress({ completedCheckpoints: 2 }),
    }));
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({
          continueAction,
          resumeAction,
          workspace: workspace(retryProgress),
        })}
      />,
    );

    expect(resumeAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Resume" }));

    expect(resumeAction).toHaveBeenCalledWith(runId);
    expect(continueAction).toHaveBeenCalledWith(runId);
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("stops on a nonretryable action failure without offering Resume", async () => {
    const continueAction = vi.fn(async () => ({
      ok: false as const,
      error: "Act! rejected the shared account credentials.",
      retryable: false,
      retryAfter: null,
    }));
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({
          continueAction,
          workspace: workspace(progress()),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue snapshot" }));

    expect(continueAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Act! rejected the shared account credentials.",
    );
    expect(screen.queryByRole("button", { name: "Resume" }))
      .not.toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("uses server-computed facet counts and URL navigation with selected-page rows only", () => {
    const storedPreview = preview();
    render(
      <ActMigrationReview
        {...props({
          query: {
            page: 3,
            pageSize: 50,
            targetEntityType: "contact",
            state: "needs_review",
          },
          workspace: workspace(
            progress({
              completedCheckpoints: 8,
              totalCheckpoints: 8,
              status: "previewed",
            }),
            storedPreview,
          ),
        })}
      />,
    );

    expect(screen.getByRole("tab", { name: "Places 70" })).toHaveAttribute(
      "href",
      `/settings/act-migration?runId=${runId}&page=1&pageSize=50&targetEntityType=organization&state=needs_review`,
    );
    expect(
      screen.getByRole("tab", { name: "Possible duplicates 84" }),
    ).toHaveAttribute(
      "href",
      `/settings/act-migration?runId=${runId}&page=1&pageSize=50&targetEntityType=contact&state=possible_duplicate`,
    );
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      `/settings/act-migration?runId=${runId}&page=4&pageSize=50&targetEntityType=contact&state=needs_review`,
    );
    expect(screen.getAllByRole("article", { name: /^Proposal / }))
      .toHaveLength(1);
    expect(screen.getByText("Page 3 of 4")).toBeVisible();
  });

  it("adopts a new server-selected empty page when navigation rerenders the same workspace", () => {
    const completedProgress = progress({
      completedCheckpoints: 8,
      totalCheckpoints: 8,
      status: "previewed",
    });
    const firstPage = preview({
      page: 4,
      pageSize: 50,
      total: 181,
      rows: [],
    });
    const secondPage = preview({
      page: 2,
      pageSize: 50,
      total: 51,
      rows: [],
      entityCounts: {
        organization: 700,
        contact: 701,
        organization_contact: 702,
        booking: 703,
        booking_contact: 704,
        calling_list: 705,
        calling_list_member: 706,
      },
      stateCounts: {
        new: 800,
        matched_unchanged: 801,
        change: 802,
        new_relationship: 803,
        possible_duplicate: 804,
        needs_review: 805,
        ignored: 806,
        error: 807,
      },
    });
    const view = render(
      <ActMigrationReview
        {...props({
          query: {
            page: 4,
            pageSize: 50,
            targetEntityType: "contact",
            state: "needs_review",
          },
          workspace: workspace(completedProgress, firstPage),
        })}
      />,
    );

    expect(screen.getByText("Page 4 of 4")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Places 70" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Previous page" }))
      .toHaveAttribute(
        "href",
        `/settings/act-migration?runId=${runId}&page=3&pageSize=50&targetEntityType=contact&state=needs_review`,
      );

    view.rerender(
      <ActMigrationReview
        {...props({
          query: {
            page: 2,
            pageSize: 50,
            targetEntityType: "contact",
            state: "needs_review",
          },
          workspace: workspace(completedProgress, secondPage),
        })}
      />,
    );

    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Places 700" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Needs review 805" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Previous page" }))
      .toHaveAttribute(
        "href",
        `/settings/act-migration?runId=${runId}&page=1&pageSize=50&targetEntityType=contact&state=needs_review`,
      );
    expect(screen.queryByRole("link", { name: "Next page" }))
      .not.toBeInTheDocument();
  });

  it("shows every required reconciliation problem category from the stored report", () => {
    render(
      <ActMigrationReview
        {...props({
          workspace: workspace(
            progress({
              completedCheckpoints: 8,
              totalCheckpoints: 8,
              status: "previewed",
            }),
            preview(),
          ),
        })}
      />,
    );

    const problems: readonly (readonly [string, string])[] = [
      ["Places without People", "13"],
      ["Multi-Place People", "14"],
      ["Opportunities without Place", "15"],
      ["Opportunities without Person", "16"],
      ["Duplicate source IDs", "17"],
      ["Incomplete checkpoints", "18"],
      ["Failed checkpoints", "19"],
    ];
    for (const [label, count] of problems) {
      const item = screen.getByText(label).closest("li");
      expect(item).not.toBeNull();
      expect(within(item!).getByText(count)).toBeVisible();
    }
  });

  it("derives decisions from proposal rules and only exposes available stored choices", () => {
    const row = proposal({
      candidateLocalIds: [candidateId, unavailableCandidateId],
      candidateChoices: [{
        id: unavailableCandidateId,
        label: "Unavailable local record",
        available: false,
      }],
    });
    render(
      <ActMigrationReview
        {...props({
          workspace: workspace(
            progress({
              completedCheckpoints: 8,
              totalCheckpoints: 8,
              status: "previewed",
            }),
            preview({ rows: [row] }),
          ),
        })}
      />,
    );

    const decision = screen.getByLabelText(
      "Decision for contact:ACT-100",
    );
    expect(within(decision).queryByRole("option", { name: "Link existing" }))
      .not.toBeInTheDocument();
    expect(within(decision).getByRole("option", { name: "Keep separate" }))
      .toBeInTheDocument();
    expect(screen.queryByText(candidateId)).not.toBeInTheDocument();
    expect(screen.queryByText(unavailableCandidateId)).not.toBeInTheDocument();
  });

  it("requires an ignore reason and saves only proposal-aware choice fields", async () => {
    const saveDecisionAction = vi.fn(async () => ({
      ok: true as const,
      changed: true,
      runId,
      proposalKey: "contact:ACT-100",
    }));
    const user = userEvent.setup();
    render(
      <ActMigrationReview
        {...props({
          saveDecisionAction,
          workspace: workspace(
            progress({
              completedCheckpoints: 8,
              totalCheckpoints: 8,
              status: "previewed",
            }),
            preview(),
          ),
        })}
      />,
    );
    const row = screen.getByRole("article", {
      name: "Proposal contact:ACT-100",
    });

    await user.selectOptions(
      within(row).getByLabelText("Decision for contact:ACT-100"),
      "ignore",
    );
    await user.click(within(row).getByRole("button", {
      name: "Save decision",
    }));
    expect(saveDecisionAction).not.toHaveBeenCalled();
    expect(within(row).getByRole("alert")).toHaveTextContent(
      "Enter a reason before ignoring this proposal.",
    );

    await user.type(
      within(row).getByLabelText("Ignore reason for contact:ACT-100"),
      "Reviewed duplicate",
    );
    await user.click(within(row).getByRole("button", {
      name: "Save decision",
    }));
    expect(saveDecisionAction).toHaveBeenCalledWith({
      runId,
      proposalKey: "contact:ACT-100",
      decision: "ignore",
      ignoreReason: "Reviewed duplicate",
    });
  });

  it("requires a primary Act Contact when approving a new consolidation", async () => {
    const saveDecisionAction = vi.fn(async () => ({
      ok: true as const,
      changed: true,
      runId,
      proposalKey: "contact:ACT-100",
    }));
    const user = userEvent.setup();
    const row = proposal({
      state: "needs_review",
      candidateLocalIds: [],
      sourceRecordKeys: ["contact:ACT-100", "contact:ACT-101"],
      proposedPrimarySourceId: null,
      primarySourceChoices: [
        { id: "ACT-100", label: "ACT-100", available: true },
        { id: "ACT-101", label: "ACT-101", available: true },
      ],
    });
    render(
      <ActMigrationReview
        {...props({
          saveDecisionAction,
          workspace: workspace(
            progress({
              completedCheckpoints: 8,
              totalCheckpoints: 8,
              status: "previewed",
            }),
            preview({ rows: [row] }),
          ),
        })}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("Decision for contact:ACT-100"),
      "approve_proposed",
    );
    const primary = screen.getByLabelText(
      "Primary Act! Contact for contact:ACT-100",
    );
    expect(primary).toBeRequired();
    await user.selectOptions(primary, "ACT-101");
    await user.click(screen.getByRole("button", { name: "Save decision" }));

    expect(saveDecisionAction).toHaveBeenCalledWith({
      runId,
      proposalKey: "contact:ACT-100",
      decision: "approve_proposed",
      primarySourceId: "ACT-101",
    });
  });

  it("serializes decision saves across proposal rows with a synchronous guard", async () => {
    let resolveFirst!: (value: {
      ok: true;
      changed: false;
      runId: string;
      proposalKey: string;
    }) => void;
    const firstSave = new Promise<{
      ok: true;
      changed: false;
      runId: string;
      proposalKey: string;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const saveDecisionAction = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({
        ok: true as const,
        changed: false,
        runId,
        proposalKey: "contact:ACT-101",
      });
    const rows = [
      proposal({
        decision: "keep_separate",
        decidedBy: "owner-42",
        decidedAt: new Date("2030-01-02T03:04:05.000Z"),
      }),
      proposal({
        id: "66666666-6666-4666-8666-666666666666",
        proposalKey: "contact:ACT-101",
        sourceRecordKeys: ["contact:ACT-101"],
        decision: "keep_separate",
        decidedBy: "owner-42",
        decidedAt: new Date("2030-01-02T03:04:05.000Z"),
      }),
    ];
    render(
      <ActMigrationReview
        {...props({
          saveDecisionAction,
          workspace: workspace(
            progress({
              completedCheckpoints: 8,
              totalCheckpoints: 8,
              status: "previewed",
            }),
            preview({ rows }),
          ),
        })}
      />,
    );
    const saveButtons = screen.getAllByRole("button", {
      name: "Save decision",
    });

    act(() => {
      saveButtons[0]!.click();
      saveButtons[1]!.click();
    });

    expect(saveDecisionAction).toHaveBeenCalledOnce();
    expect(saveButtons.every((button) => button.hasAttribute("disabled")))
      .toBe(true);

    await act(async () => {
      resolveFirst({
        ok: true,
        changed: false,
        runId,
        proposalKey: "contact:ACT-100",
      });
    });
    expect(saveButtons.every((button) => !button.hasAttribute("disabled")))
      .toBe(true);

    saveButtons[1]!.click();
    await waitFor(() => expect(saveDecisionAction).toHaveBeenCalledTimes(2));
  });

  it("restores persisted decision metadata after remount without rendering raw inputs", () => {
    const persisted = proposal({
      candidateLocalIds: [candidateId, "raw-source-candidate"],
      decision: "link_existing",
      chosenLocalEntityId: candidateId,
      primarySourceId: "ACT-100",
      decidedBy: "owner-42",
      decidedAt: new Date("2030-01-02T03:04:05.000Z"),
      candidateChoices: [{
        id: candidateId,
        label: "Local Avery Example",
        available: true,
      }],
      primarySourceChoices: [{
        id: "ACT-100",
        label: "ACT-100",
        available: true,
      }],
    });
    const ignored = proposal({
      id: "66666666-6666-4666-8666-666666666666",
      proposalKey: "contact:ACT-101",
      sourceRecordKeys: ["contact:ACT-101"],
      decision: "ignore",
      decisionReason: "Reviewed duplicate source",
      decidedBy: "owner-42",
      decidedAt: new Date("2030-01-02T03:04:05.000Z"),
    });
    const approvedProposedPrimary = proposal({
      id: "77777777-7777-4777-8777-777777777777",
      proposalKey: "contact:ACT-PROPOSED",
      sourceRecordKeys: ["contact:ACT-PROPOSED"],
      state: "new",
      issueCode: null,
      decision: "approve_proposed",
      primarySourceId: null,
      proposedPrimarySourceId: "ACT-PROPOSED",
      decidedBy: "owner-42",
      decidedAt: new Date("2030-01-02T03:04:05.000Z"),
      primarySourceChoices: [{
        id: "ACT-PROPOSED",
        label: "ACT-PROPOSED",
        available: true,
      }],
    });
    const safeProps = props({
      databaseName: "RawDatabase3125",
      password: "raw-password",
      username: "raw-user",
      workspace: workspace(
        progress({
          completedCheckpoints: 8,
          totalCheckpoints: 8,
          status: "previewed",
        }),
        preview({
          rows: [
            {
              ...persisted,
              rawSnapshot: { password: "snapshot-password" },
            } as StoredMigrationProposal,
            ignored,
            approvedProposedPrimary,
          ],
        }),
      ),
    });
    const first = render(<ActMigrationReview {...safeProps} />);

    expect(screen.getByText("Decision: Link existing")).toBeVisible();
    expect(screen.getByText("Candidate: Local Avery Example")).toBeVisible();
    expect(screen.getByText("Primary Act! Contact: ACT-100")).toBeVisible();
    expect(
      screen.getByText("Primary Act! Contact: ACT-PROPOSED"),
    ).toBeVisible();
    expect(screen.getByText("Reason: Reviewed duplicate source")).toBeVisible();
    expect(
      screen.getAllByText(
        "Reviewed by owner-42 at 2030-01-02T03:04:05.000Z",
      ),
    ).toHaveLength(3);
    first.unmount();
    render(<ActMigrationReview {...safeProps} />);
    expect(screen.getByText("Decision: Link existing")).toBeVisible();

    const markup = document.body.textContent ?? "";
    expect(markup).not.toContain("RawDatabase3125");
    expect(markup).not.toContain("raw-password");
    expect(markup).not.toContain("raw-user");
    expect(markup).not.toContain("snapshot-password");
    expect(markup).not.toContain("raw-source-candidate");
  });

  it("shows approved work in one confirmation before applying a complete authorized preview", async () => {
    const startApplyAction = vi.fn(() => new Promise<never>(() => {}));
    const user = userEvent.setup();
    const staticGroup = proposal({
      proposalKey: "calling_list:ACT-GROUP",
      targetEntityType: "calling_list",
      state: "needs_review",
      issueCode: "group_membership_semantics_unknown",
      sourceRecordKeys: ["group:ACT-GROUP"],
    });
    const reviewedWorkspace = {
      ...workspace(
        progress({
          completedCheckpoints: 8,
          totalCheckpoints: 8,
          status: "previewed",
        }),
        preview({ rows: [staticGroup] }),
      ),
      apply: {
        ready: true,
        summary: { approved: 25, pending: 7, blocked: 2, ignored: 3, applied: 0, failed: 0 },
        byTarget: {},
        bulkEligible: 0,
      },
    } as unknown as StoredMigrationWorkspace;

    render(
      <ActMigrationReview
        {...props({
          applyEnabled: true,
          startApplyAction,
          workspace: reviewedWorkspace,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Confirm static Group" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /bulk approve/i })).not.toBeInTheDocument();
    expect(screen.getByText("Approved 25 · Pending 7 · Blocked 2 · Ignored 3")).toBeVisible();
    const button = screen.getByRole("button", { name: "Apply approved changes" });
    await user.click(button);
    expect(screen.getByRole("heading", { name: "Confirm approved changes" })).toBeVisible();
    const confirmation = screen.getByRole("heading", { name: "Confirm approved changes" }).closest("section");
    expect(confirmation).not.toBeNull();
    for (const label of ["Places", "Contacts", "Relationships", "Calling lists"]) {
      const item = within(confirmation!).getByText(label).parentElement;
      expect(item).not.toBeNull();
      expect(within(item!).getByText("0")).toBeVisible();
    }
    const confirm = screen.getByRole("button", { name: "Import approved records" });
    await user.click(confirm);
    expect(startApplyAction).toHaveBeenCalledTimes(1);
    expect(startApplyAction).toHaveBeenCalledWith({
      requestKey,
      runId,
      previewDigest: "safe-proposal-digest",
      confirmationToken: "apply-approved-changes",
    });
    await user.dblClick(confirm);
    expect(startApplyAction).toHaveBeenCalledTimes(1);
  });

  it("keeps unresolved work queued and explains when rollout authorization is disabled", () => {
    const apply = {
      ready: true,
      summary: { approved: 1, pending: 0, blocked: 0, ignored: 0, applied: 0, failed: 0 },
      byTarget: {},
      bulkEligible: 1,
    };
    const completeWorkspace = {
      ...workspace(progress({ completedCheckpoints: 8, totalCheckpoints: 8, status: "previewed" }), preview()),
      apply,
    } as unknown as StoredMigrationWorkspace;
    const view = render(<ActMigrationReview {...props({ applyEnabled: false, workspace: completeWorkspace })} />);
    expect(screen.queryByRole("button", { name: "Apply approved changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Reviewed import rollout is disabled in this environment.")).toBeVisible();
    view.rerender(<ActMigrationReview {...props({ applyEnabled: true, workspace: { ...completeWorkspace, apply: { ...apply, ready: false, summary: { ...apply.summary, pending: 1 } } } })} />);
    expect(screen.queryByRole("button", { name: "Apply approved changes" })).not.toBeInTheDocument();
    expect(screen.getByText("1 unresolved proposal remains queued for review.")).toBeVisible();
  });

  it("shows queue results and retries only the same failed batch", async () => {
    const startApplyAction = vi.fn(async () => ({
      ok: true as const,
      runId,
      batchId: "44444444-4444-4444-8444-444444444444",
      changed: true,
      counts: { pending: 0, leased: 0, blocked: 2, applied: 3, ignored: 4, failed: 1, total: 10 },
      retryable: false,
      retryAfter: null,
      errorCode: null,
    }));
    const retryApplyAction = vi.fn(async () => ({
      ok: true as const,
      runId,
      batchId: "44444444-4444-4444-8444-444444444444",
      changed: false,
      counts: { pending: 0, leased: 0, blocked: 2, applied: 4, ignored: 4, failed: 0, total: 10 },
      retryable: false,
      retryAfter: null,
      errorCode: null,
    }));
    const user = userEvent.setup();
    const reviewedWorkspace = {
      ...workspace(progress({ completedCheckpoints: 8, totalCheckpoints: 8, status: "previewed" }), preview()),
      apply: {
        ready: true,
        summary: { approved: 1, pending: 0, blocked: 0, ignored: 0, applied: 0, failed: 0 },
        byTarget: {},
        bulkEligible: 0,
      },
    } as unknown as StoredMigrationWorkspace;
    render(<ActMigrationReview {...props({ applyEnabled: true, startApplyAction, retryApplyAction, workspace: reviewedWorkspace })} />);

    await user.click(screen.getByRole("button", { name: "Apply approved changes" }));
    await user.click(screen.getByRole("button", { name: "Import approved records" }));
    expect(screen.getByText("Succeeded 3 · Skipped 4 · Blocked 2 · Failed 1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry failed operations" }));
    expect(retryApplyAction).toHaveBeenCalledWith({
      runId,
      batchId: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("adds Act! migration beside unchanged Act! Sync in desktop and mobile Settings", () => {
    render(<AppShell><p>Settings page</p></AppShell>);

    const syncLinks = screen.getAllByRole("link", { name: "Act! Sync" });
    expect(syncLinks).toHaveLength(2);
    expect(syncLinks.every((link) =>
      link.getAttribute("href") === "/settings/act-sync"
    )).toBe(true);
    const migrationLinks = screen.getAllByRole("link", {
      name: "Act! migration",
    });
    expect(migrationLinks).toHaveLength(2);
    expect(migrationLinks.every((link) =>
      link.getAttribute("href") === "/settings/act-migration"
    )).toBe(true);
  });
});
