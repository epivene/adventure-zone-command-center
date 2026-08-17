// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const managerApi = vi.fn(async (path: string) => {
  if (path === "/manager/money/summary") return { expenses: [] };
  return {};
});

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a", legName: "Leg A" }, managerApi }),
}));

import ManagerReceiptsPage from "./ManagerReceiptsPage";

describe("ManagerReceiptsPage", () => {
  it("lets a manager start a receipt scan or manual expense when no expenses exist", async () => {
    render(<ManagerReceiptsPage />);
    expect(await screen.findByText("No expenses yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add receipt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense manually" })).toBeInTheDocument();
  });
});
