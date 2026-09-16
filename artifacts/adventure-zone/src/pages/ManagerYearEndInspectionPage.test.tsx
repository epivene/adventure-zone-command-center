import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ManagerYearEndInspectionContent } from "./ManagerYearEndInspectionPage";
import type { ManagerApi, YearEndInspectionDto } from "@/lib/year-end-inspections-api";
import { MemoryManagerMutationStore } from "@/lib/manager-sync-queue";

const entries: YearEndInspectionDto["entries"] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    pieceId: "piece-1",
    pieceCodeSnapshot: "AZ-017",
    pieceNameSnapshot: "Front section",
    resourceNameSnapshot: "Warrior Wall",
    entryState: "not_started",
    condition: null,
    inspectionNotes: null,
    repairNeeded: false,
    repairNotes: null,
    retainForFutureUse: true,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    pieceId: "piece-2",
    pieceCodeSnapshot: "AZ-018",
    pieceNameSnapshot: "Back section",
    resourceNameSnapshot: "Warrior Wall",
    entryState: "not_started",
    condition: null,
    inspectionNotes: null,
    repairNeeded: false,
    repairNotes: null,
    retainForFutureUse: true,
  },
];

function withProgress(inspection: Omit<YearEndInspectionDto, "progress">): YearEndInspectionDto {
  const notStarted = inspection.entries.filter((entry) => entry.entryState === "not_started").length;
  return {
    ...inspection,
    progress: {
      total: inspection.entries.length,
      notStarted,
      inspected: inspection.entries.filter((entry) => entry.entryState === "inspected").length,
      notPresent: inspection.entries.filter((entry) => entry.entryState === "not_present").length,
      needsAttention: inspection.entries.filter((entry) => entry.repairNeeded).length,
      percentComplete: Math.round(((inspection.entries.length - notStarted) / inspection.entries.length) * 100),
    },
  };
}

describe("ManagerYearEndInspectionPage", () => {
  it("starts from current pieces and blocks completion until all entries resolve", async () => {
    const user = userEvent.setup();
    let inspection: YearEndInspectionDto | null = null;
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path.includes("?year=")) return { inspection: null };
      if (path === "/manager/year-end-inspections" && options?.method === "POST") {
        inspection = withProgress({
          id: "10000000-0000-4000-8000-000000000001",
          legId: "30000000-0000-4000-8000-000000000001",
          inspectionYear: 2026,
          status: "in_progress",
          copiedFromInspectionId: null,
          updatedAt: new Date().toISOString(),
          completedAt: null,
          entries,
        });
        return { inspection };
      }
      if (path.includes("/entries/") && options?.method === "PATCH") {
        const patch = JSON.parse(String(options.body));
        inspection = withProgress({
          ...inspection!,
          entries: inspection!.entries.map((entry) => entry.id === path.split("/").at(-1) ? { ...entry, ...patch } : entry),
        });
        return { entry: inspection.entries[0] };
      }
      if (path.includes("/manager/year-end-inspections/")) return { inspection };
      throw new Error(`Unexpected request ${path}`);
    });

    render(<ManagerYearEndInspectionContent
      currentYear={2026}
      legId="30000000-0000-4000-8000-000000000001"
      managerApi={api as unknown as ManagerApi}
      mutationStore={new MemoryManagerMutationStore()}
    />);
    await user.click(await screen.findByRole("button", { name: "Use pieces assigned to this leg" }));
    expect(await screen.findByText("0 of 2 inspected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /AZ-017 Front section/ }));
    await user.selectOptions(screen.getByLabelText("Condition"), "minor_repair");
    await user.type(screen.getByLabelText("Inspection notes"), "Worn seam near entrance");
    await user.click(screen.getByRole("button", { name: "Save piece inspection" }));
    expect(await screen.findByText("1 of 2 inspected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete inspection" })).toBeDisabled();
  });
});
