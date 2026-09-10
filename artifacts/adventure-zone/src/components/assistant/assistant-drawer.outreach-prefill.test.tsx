import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@/features/assistant/lead-scout-api", () => ({ getLatestLeadScoutRun: vi.fn().mockResolvedValue(null) }));

import { AssistantContextProvider, useAssistantContext } from "@/features/assistant/assistant-context";
import { AssistantDrawer } from "./assistant-drawer";

function PlannerLaunches() {
  const { openAssistant } = useAssistantContext();
  const open = (dateEnd: string) => openAssistant("", {
    anchorLabel: "Northern route",
    radiusMiles: 100,
    dateStart: "2026-10-01",
    dateEnd,
    criteriaSummary: `Northern route through ${dateEnd}`,
  });
  return <><button type="button" onClick={() => open("2026-10-10")}>First planner launch</button><button type="button" onClick={() => open("2026-10-20")}>Updated planner launch</button></>;
}

afterEach(cleanup);

describe("planner Lead Scout prefill", () => {
  it("remounts the initialized form when only the saved end date changes", async () => {
    render(<AssistantContextProvider><PlannerLaunches /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "First planner launch" }));
    const firstEnd = await screen.findByLabelText("End date");
    expect(firstEnd).toHaveValue("2026-10-10");
    fireEvent.change(firstEnd, { target: { value: "2026-10-15" } });

    fireEvent.click(screen.getByRole("button", { name: "Updated planner launch" }));
    await waitFor(() => expect(screen.getByLabelText("End date")).toHaveValue("2026-10-20"));
    expect(screen.getByText(/Northern route through 2026-10-20/)).toBeInTheDocument();
  });
});
