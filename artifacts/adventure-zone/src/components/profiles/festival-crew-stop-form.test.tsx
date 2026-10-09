// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankStop, FestivalCrewStopForm } from "./festival-crew-stop-form";

afterEach(cleanup);
describe("crew stop staff confirmations", () => {
  it("saves explicit dates and shows them again when reopened", () => {
    const onSave = vi.fn();
    const initial = { ...blankStop(), name: "RV stop", rigFit: "yes" as const, hookups: "no" as const };
    const { unmount } = render(<FestivalCrewStopForm initial={initial} busy={false} error={null} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Rig fit staff-confirmed date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Hookups staff-confirmed date"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save crew stop" }));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ rigFitConfirmedOn: "2026-10-01", hookupsConfirmedOn: "2026-09-30", overnightConfirmedOn: null });
    unmount();
    render(<FestivalCrewStopForm initial={{ ...saved, expectedUpdatedAt: "2026-10-09T00:00:00Z" }} busy={false} error={null} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue("2026-10-01")).toBeTruthy();
    expect(screen.getByDisplayValue("2026-09-30")).toBeTruthy();
    expect(screen.getByText(/Staff confirmed 2026-10-01/)).toBeTruthy();
    expect(screen.getByLabelText("Overnight parking staff-confirmed date")).toHaveProperty("disabled", true);
  });
  it("clears rig confirmation when max rig length changes and permits clearing a date", () => {
    const onSave = vi.fn();
    render(<FestivalCrewStopForm initial={{ ...blankStop(), name: "RV stop", rigFit: "yes", rigFitConfirmedOn: "2026-10-01", hookups: "no", hookupsConfirmedOn: "2026-10-01" }} busy={false} error={null} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Max rig length (feet)"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Hookups staff-confirmed date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save crew stop" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ maxRigLengthFeet: 45, rigFitConfirmedOn: null, hookupsConfirmedOn: null });
  });
});
