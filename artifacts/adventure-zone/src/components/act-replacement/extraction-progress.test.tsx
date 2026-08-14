import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExtractionProgress } from "./extraction-progress";
import type { ActReplacementStatus } from "@/features/act-replacement/act-replacement-client";

const status: ActReplacementStatus = {
  runId: "run-1",
  phase: "extracting",
  previewOnly: true,
  pageSize: 100,
  streams: [
    {
      streamType: "company",
      state: "mixed",
      completedCheckpoints: 1,
      totalCheckpoints: 2,
      queryMode: "projected",
      lastSucceededAt: null,
      error: { code: "timeout", retryable: true, retryAfter: null },
      responseRows: 12,
      observedIdentities: 10,
      archivedIdentities: 8,
      completeIdentities: 7,
      partialIdentities: 1,
      failedIdentities: 0,
      snapshotVersionsInserted: 12,
    },
  ],
  allStreams: {
    responseRows: 12,
    observedIdentities: 10,
    archivedIdentities: 8,
    completeIdentities: 7,
    partialIdentities: 1,
    failedIdentities: 0,
    snapshotVersionsInserted: 12,
    unsupportedCapabilities: 0,
  },
  canResume: true,
  canStartOver: true,
};

afterEach(cleanup);

describe("ExtractionProgress", () => {
  it("shows fetched and archived identity progress with expandable diagnostics", () => {
    render(
      <ExtractionProgress
        status={status}
        onResume={() => {}}
        onStartOver={() => {}}
      />,
    );
    expect(screen.getByText(/10 identities fetched/i)).toBeInTheDocument();
    expect(screen.getByText(/8 identities archived/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /diagnostics/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/resume/i)).toBeInTheDocument();
    expect(screen.getByText(/start over/i)).toBeInTheDocument();
  });

  it("shows checkpoint progress after identity discovery stops changing", () => {
    render(
      <ExtractionProgress
        status={status}
        onResume={() => {}}
        onStartOver={() => {}}
      />,
    );

    expect(
      screen.getByText("1 of 2 extraction tasks finished"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Extraction tasks" }),
    ).toHaveAttribute("aria-valuenow", "1");
    expect(
      screen.getByText(/identity count can stay unchanged/i),
    ).toBeInTheDocument();
  });

  it("states the preview-only boundary when complete", () => {
    render(
      <ExtractionProgress
        status={{ ...status, phase: "complete" }}
        onResume={() => {}}
        onStartOver={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "Everything fetched so far is safely archived. Nothing has been added to profiles yet.",
      ),
    ).toBeInTheDocument();
  });

  it("does not claim preview-only behavior after profile mutations start", () => {
    render(
      <ExtractionProgress
        status={{ ...status, phase: "complete" }}
        profileImportStarted
        onResume={() => {}}
        onStartOver={() => {}}
      />,
    );

    expect(screen.queryByText("Preview only")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing has been added to profiles yet/i),
    ).not.toBeInTheDocument();
  });
});
