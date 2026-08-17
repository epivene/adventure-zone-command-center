import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getRecoveryStatus: vi.fn(),
  startRecovery: vi.fn(),
  getRecoveryReview: vi.fn(),
  searchRecoveryProfiles: vi.fn(),
  assignRecoveryParent: vi.fn(),
  dropRecoveryItem: vi.fn(),
  retryRecoveryItem: vi.fn(),
}));

vi.mock("@/features/act-recovery/act-recovery-client", () => client);

import ActRecoveryPage from "./ActRecoveryPage";

const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const PROFILE_ID = "40000000-0000-4000-8000-000000000001";

function status(overrides: Record<string, unknown> = {}) {
  return {
    runId: "10000000-0000-4000-8000-000000000001",
    sourceDatabaseKey: "archive-db",
    state: "running",
    candidateCount: 12,
    checkedCount: 9,
    pending: 2,
    leased: 0,
    alreadyPresent: 3,
    recovered: 5,
    needsReview: 1,
    droppedUnusable: 0,
    retryableFailed: 1,
    complete: false,
    byStreamType: {},
    ...overrides,
  };
}

const reviewPage = {
  page: 1,
  pageSize: 50,
  items: [{
    itemId: "50000000-0000-4000-8000-000000000001",
    runId: "10000000-0000-4000-8000-000000000001",
    sourceRecordId: SOURCE_ID,
    sourceVersionId: VERSION_ID,
    streamType: "history",
    actRecordId: "history-1",
    rawSnapshot: {
      regarding: "E-mail sent",
      details: "Proposal package sent",
      startTime: "2025-04-16T14:30:00Z",
    },
    relationshipEvidence: {},
    targetSummary: { reason: "timeline_parent_unresolved" },
  }],
};

describe("ActRecoveryPage", () => {
  beforeEach(() => {
    client.getRecoveryStatus.mockResolvedValue(status());
    client.getRecoveryReview.mockResolvedValue(reviewPage);
    client.startRecovery.mockResolvedValue(status());
    client.searchRecoveryProfiles.mockResolvedValue([
      { id: PROFILE_ID, name: "16th Street Fair (Denver) CO", city: "Denver", region: "CO" },
    ]);
    client.assignRecoveryParent.mockResolvedValue({ ok: true });
    client.dropRecoveryItem.mockResolvedValue({ ok: true });
    client.retryRecoveryItem.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows archive recovery totals and the original ACT review content", async () => {
    render(<ActRecoveryPage />);

    expect(await screen.findByRole("heading", { name: "ACT Recovery" })).toBeInTheDocument();
    expect(screen.getByText("Archived candidates")).toBeInTheDocument();
    expect(screen.getByText("Already present")).toBeInTheDocument();
    expect(screen.getByText("Recovered")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("Dropped unusable")).toBeInTheDocument();
    expect(screen.getByText("Retryable failures")).toBeInTheDocument();
    expect(await screen.findByText("Proposal package sent")).toBeInTheDocument();
    expect(screen.getByText("E-mail sent")).toBeInTheDocument();
    expect(screen.getByText(/Apr 16, 2025/)).toBeInTheDocument();
  });

  it("searches profiles and assigns an unresolved ACT history item for retry", async () => {
    render(<ActRecoveryPage />);
    await screen.findByText("Proposal package sent");

    fireEvent.change(screen.getByLabelText("Find profile"), {
      target: { value: "16th Street" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    const profile = await screen.findByRole("button", { name: /16th Street Fair \(Denver\) CO/ });
    fireEvent.click(profile);
    fireEvent.click(screen.getByRole("button", { name: "Assign & retry" }));

    await waitFor(() => expect(client.assignRecoveryParent).toHaveBeenCalledWith({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: VERSION_ID,
      targetEntityType: "organization",
      targetEntityId: PROFILE_ID,
    }));
  });

  it("keeps dropping an archive record as an explicit separate action", async () => {
    render(<ActRecoveryPage />);
    await screen.findByText("Proposal package sent");

    fireEvent.click(screen.getByRole("button", { name: "Drop unusable" }));

    await waitFor(() => expect(client.dropRecoveryItem).toHaveBeenCalledWith({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: VERSION_ID,
    }));
  });
});
