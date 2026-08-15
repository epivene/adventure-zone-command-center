// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegManagerAccess } from "./leg-manager-access";

const mocks = vi.hoisted(() => ({
  get: vi.fn(async () => ({ legs: [
    { legId: "leg-a", legName: "Leg A", archivedAt: null, managerName: "Amy", enabled: true, sessionVersion: 3 },
    { legId: "leg-b", legName: "Leg B", archivedAt: "2026-08-15T00:00:00Z", managerName: null, enabled: false, sessionVersion: null },
  ] })),
  put: vi.fn(async () => ({ ok: true })),
  fetcher: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })),
}));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.get, apiPut: mocks.put, apiFetch: mocks.fetcher }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LegManagerAccess", () => {
  it("keeps passwords write-only and disables archived leg access", async () => {
    render(<LegManagerAccess />);
    await screen.findByText("Leg A");
    expect(screen.getByText("Archived — portal disabled")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/hash|salt/i)).not.toBeInTheDocument();
    const password = screen.getByLabelText("New password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(password.value).toBe("");
  });

  it("requires confirmation before signing out all devices", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LegManagerAccess />);
    await screen.findByText("Leg A");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out All Devices" }));
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });
});
