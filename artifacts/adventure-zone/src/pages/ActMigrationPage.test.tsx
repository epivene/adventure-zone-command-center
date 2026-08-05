import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActMigrationPage from "./ActMigrationPage";

vi.mock("@/features/act-replacement/act-replacement-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/act-replacement/act-replacement-client")>()),
  getLatestRun: vi.fn().mockResolvedValue({ run: null }),
  startRun: vi.fn().mockResolvedValue({ created: true, run: { runId: "run-1", phase: "extracting", previewOnly: true, pageSize: 100, streams: [], allStreams: { responseRows: 0, observedIdentities: 0, archivedIdentities: 0, completeIdentities: 0, partialIdentities: 0, failedIdentities: 0, snapshotVersionsInserted: 0, unsupportedCapabilities: 0 }, canResume: true, canStartOver: true } }), getRun: vi.fn(), resumeRun: vi.fn(), supersedeRun: vi.fn(),
}));
afterEach(cleanup);

describe("ActMigrationPage", () => {
  it("offers one import flow without legacy credentials or apply controls", async () => {
    render(<ActMigrationPage />);
    expect(await screen.findByRole("button", { name: /import everything from act/i })).toBeInTheDocument();
    expect(screen.queryByText(/calendar.*route scan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/apply/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password|username|database/i)).not.toBeInTheDocument();
  });

  it("limits advanced batch sizes and defaults to 100", async () => {
    render(<ActMigrationPage />);
    expect(await screen.findByLabelText(/batch size/i)).toHaveValue("100");
    expect(screen.getByRole("option", { name: "25" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "50" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "200" })).toBeInTheDocument();
  });

  it("starts polling after starting a run from an empty page", async () => {
    const timer = vi.spyOn(globalThis, "setInterval");
    render(<ActMigrationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /import everything from act/i }));
    await waitFor(() => expect(timer).toHaveBeenCalled());
    timer.mockRestore();
  });
});
