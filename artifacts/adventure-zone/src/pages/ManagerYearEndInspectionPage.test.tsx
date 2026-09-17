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
    await user.click(await screen.findByRole("button", { name: "Use this leg's attraction records" }));
    expect(await screen.findByText("0 of 2 inspected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /AZ-017 Front section/ }));
    await user.selectOptions(screen.getByLabelText("Condition"), "minor_repair");
    await user.type(screen.getByLabelText("Inspection notes"), "Worn seam near entrance");
    await user.click(screen.getByRole("button", { name: "Save attraction inspection" }));
    expect(await screen.findByText("1 of 2 inspected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete inspection" })).toBeDisabled();
  });

  it("lets a manager build a blank inspection by photographing and labeling newly discovered pieces", async () => {
    const user = userEvent.setup();
    let inspection: YearEndInspectionDto | null = null;
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path.includes("?year=")) return { inspection: null };
      if (path === "/manager/year-end-inspections/resources") {
        return { resources: [{ id: "resource-1", name: "Warrior's Playground" }] };
      }
      if (path === "/manager/year-end-inspections" && options?.method === "POST") {
        inspection = withProgress({
          id: "10000000-0000-4000-8000-000000000001",
          legId: "30000000-0000-4000-8000-000000000001",
          inspectionYear: 2026,
          status: "draft",
          copiedFromInspectionId: null,
          updatedAt: new Date().toISOString(),
          completedAt: null,
          entries: [],
        });
        return { inspection };
      }
      if (path.endsWith("/discovered-pieces") && options?.method === "POST") {
        const body = JSON.parse(String(options.body));
        inspection = withProgress({
          ...inspection!,
          status: "in_progress",
          entries: [{
            id: body.entryId,
            pieceId: body.pieceId,
            pieceCodeSnapshot: "NEW-0001",
            pieceNameSnapshot: body.name,
            resourceNameSnapshot: "Warrior's Playground",
            entryState: "not_started",
            condition: null,
            inspectionNotes: body.identityNotes,
            repairNeeded: false,
            repairNotes: null,
            retainForFutureUse: true,
          }],
        });
        return { inspection };
      }
      throw new Error(`Unexpected request ${path}`);
    });

    render(<ManagerYearEndInspectionContent
      currentYear={2026}
      legId="30000000-0000-4000-8000-000000000001"
      managerApi={api as unknown as ManagerApi}
      mutationStore={new MemoryManagerMutationStore()}
    />);

    await user.click(await screen.findByRole("button", { name: "Start inspecting attractions" }));
    await user.click(await screen.findByRole("button", { name: "Add & Inspect an Attraction" }));
    await user.type(screen.getByLabelText("Attraction name or label"), "Blue slide section");
    await user.type(screen.getByLabelText("Identification notes"), "Rolled beside the generator");
    await user.selectOptions(screen.getByLabelText("Leg record"), "resource-1");
    await user.click(screen.getByRole("button", { name: "Save & inspect this attraction" }));

    expect(await screen.findByRole("button", { name: /NEW-0001 Blue slide section/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Take Photo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose From Gallery" })).toBeVisible();
    expect(screen.getByText("0 of 1 inspected")).toBeVisible();
  });

  it("removes an accidental discovered piece through the guarded endpoint", async () => {
    const user = userEvent.setup();
    const discovered = { ...entries[0], pieceCodeSnapshot: "NEW-A058BD54", pieceNameSnapshot: "Hot Air Balloon Castle" };
    let inspection = withProgress({
      id: "10000000-0000-4000-8000-000000000001",
      legId: "30000000-0000-4000-8000-000000000001",
      inspectionYear: 2026,
      status: "in_progress",
      copiedFromInspectionId: null,
      updatedAt: new Date().toISOString(),
      completedAt: null,
      entries: [discovered],
    });
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path.includes("?year=2025")) return { inspection: null };
      if (path.includes("?year=2026")) return { inspection };
      if (path === "/manager/year-end-inspections/resources") return { resources: [] };
      if (path.endsWith(`/discovered-pieces/${discovered.id}`) && options?.method === "DELETE") {
        inspection = withProgress({ ...inspection, entries: [] });
        return { inspection, deletedPhotos: 1 };
      }
      throw new Error(`Unexpected request ${path}`);
    });

    render(<ManagerYearEndInspectionContent
      currentYear={2026}
      legId="30000000-0000-4000-8000-000000000001"
      managerApi={api as unknown as ManagerApi}
      mutationStore={new MemoryManagerMutationStore()}
    />);

    await user.click(await screen.findByRole("button", { name: /NEW-A058BD54 Hot Air Balloon Castle/ }));
    await user.click(screen.getByRole("button", { name: "Remove accidental attraction" }));
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));

    expect(await screen.findByText("Accidental attraction removed")).toBeVisible();
    expect(screen.queryByText("Hot Air Balloon Castle")).not.toBeInTheDocument();
  });
});
