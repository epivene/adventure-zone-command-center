import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpendingControls } from "./SpendingControls";
import { workspaceApi } from "@/features/assistant-workspace/api";
import { spendingSummary } from "@/test/assistant-spending";

vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(workspaceApi).mockResolvedValue(spendingSummary);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openControls() {
  await screen.findByText(/\$0.70 available/);
  fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
  return screen.getByLabelText("Daily spending limit (USD)");
}

it("saves a zero limit and reloads the server pause without starting work", async () => {
  const paused = {
    ...spendingSummary,
    version: 2,
    dailyLimitUsd: 0,
    remainingUsd: 0,
    paused: true,
  };
  vi.mocked(workspaceApi).mockImplementation(async (_path, method, body) => {
    if (method === "PATCH") {
      expect(body).toEqual({
        version: 1,
        dailyLimitUsd: 0,
        monthlyLimitUsd: 30,
        economyMode: true,
      });
      return paused;
    }
    return spendingSummary;
  });
  const view = render(<SpendingControls />);
  fireEvent.change(await openControls(), { target: { value: "0" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  expect(
    await screen.findByText("Saved. Paid AI work is paused."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Daily spending limit (USD)")).toHaveValue(
    "0.00",
  );
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.every(
        ([path, method]) => path === "/spending" && method !== "POST",
      ),
  ).toBe(true);
  view.unmount();
  vi.mocked(workspaceApi).mockResolvedValue(paused);
  render(<SpendingControls />);
  expect(
    await screen.findByText(/Paid AI paused · \$0.00 daily limit/),
  ).toBeInTheDocument();
});

it("retains unsaved edits across usage polling and requires review after a version conflict", async () => {
  vi.useFakeTimers();
  const current = {
    ...spendingSummary,
    version: 2,
    dailyLimitUsd: 3,
    economyMode: false,
    remainingUsd: 2.2,
  };
  let changed = false;
  vi.mocked(workspaceApi).mockImplementation(async (_path, method) => {
    if (method === "PATCH") throw new Error("ASSISTANT_SPENDING_CONFLICT");
    return changed ? current : spendingSummary;
  });
  await act(async () => {
    render(<SpendingControls active />);
  });
  fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
  const input = screen.getByLabelText("Daily spending limit (USD)");
  fireEvent.change(input, { target: { value: "2.50" } });
  changed = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  vi.useRealTimers();
  expect(input).toHaveValue("2.50");
  expect(screen.getByRole("checkbox", { name: "Economy mode" })).toBeChecked();
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "changed elsewhere",
  );
  expect(workspaceApi).toHaveBeenCalledWith("/spending", "PATCH", {
    version: 1,
    dailyLimitUsd: 2.5,
    monthlyLimitUsd: 30,
    economyMode: true,
  });
  expect(
    screen.getByRole("button", { name: "Save spending settings" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review current settings" }),
  );
  expect(
    await screen.findByText(
      /Current setting: \$3.00 per day, \$30.00 per month, Economy off/,
    ),
  ).toBeInTheDocument();
  expect(input).toHaveValue("2.50");
  expect(
    screen.getByRole("button", { name: "Save spending settings" }),
  ).toBeEnabled();
  vi.mocked(workspaceApi).mockResolvedValue({
    ...current,
    version: 3,
    dailyLimitUsd: 2.5,
    monthlyLimitUsd: 30,
    economyMode: true,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  await waitFor(() =>
    expect(workspaceApi).toHaveBeenCalledWith("/spending", "PATCH", {
      version: 2,
      dailyLimitUsd: 2.5,
      monthlyLimitUsd: 30,
      economyMode: true,
    }),
  );
});

it("invalidates older reads when saving and never replaces saved settings with a late read", async () => {
  let finishRead!: (value: unknown) => void;
  let gets = 0;
  vi.mocked(workspaceApi).mockImplementation(async (_path, method) => {
    if (method === "PATCH")
      return { ...spendingSummary, version: 2, dailyLimitUsd: 4 };
    if (++gets === 1) return spendingSummary;
    return new Promise((resolve) => {
      finishRead = resolve;
    });
  });
  render(<SpendingControls />);
  const input = await openControls();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh spending usage" }),
  );
  fireEvent.change(input, { target: { value: "4" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  await screen.findByText(
    "Spending settings saved. Send a message when you are ready.",
  );
  await act(async () => finishRead(spendingSummary));
  expect(input).toHaveValue("4.00");
  expect(screen.getByText(/\$4.00 daily limit/)).toBeInTheDocument();
});

it("keeps controls read-only offline and reconnects without saving or resuming", async () => {
  const connectivity = vi.spyOn(navigator, "onLine", "get");
  render(<SpendingControls />);
  const input = await openControls();
  fireEvent.change(input, { target: { value: "5" } });
  connectivity.mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(input).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Save spending settings" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Any amounts shown were last checked online/),
  ).toBeInTheDocument();
  connectivity.mockReturnValue(true);
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue("5");
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.every(([, method]) => !method || method === "GET"),
  ).toBe(true);
});

it("refreshes completed-run usage even when the previous usage read is still pending", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(workspaceApi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<SpendingControls active refreshKey="running" />);
  view.rerender(<SpendingControls active={false} refreshKey="completed" />);
  await act(async () =>
    finish({
      ...spendingSummary,
      paused: true,
      remainingUsd: 0,
      reservedUsd: 1,
    }),
  );
  expect(await screen.findByText(/\$0.70 available/)).toBeInTheDocument();
  expect(workspaceApi).toHaveBeenCalledTimes(2);
});

it("does not show a false zero for unavailable usage and keeps failed edits", async () => {
  vi.mocked(workspaceApi).mockRejectedValueOnce(new Error("network"));
  render(<SpendingControls />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be refreshed",
  );
  expect(screen.getByText("Spending usage unavailable")).toBeInTheDocument();
  expect(screen.queryByText(/\$0.00/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh spending usage" }),
  );
  const input = await screen.findByLabelText("Daily spending limit (USD)");
  fireEvent.change(input, { target: { value: "7.25" } });
  vi.mocked(workspaceApi).mockRejectedValueOnce(new Error("network"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your edits are still here",
  );
  expect(input).toHaveValue("7.25");
});

it("only switches the next model after Economy is explicitly enabled and saved", async () => {
  const select = vi.fn();
  const before = {
    ...spendingSummary,
    economyMode: false,
    economyModel: "gpt-6-luna",
  };
  vi.mocked(workspaceApi).mockResolvedValue(before);
  render(<SpendingControls onEconomyEnabled={select} />);
  await openControls();
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Economy mode" }));
  expect(select).not.toHaveBeenCalled();
  vi.mocked(workspaceApi).mockResolvedValue({
    ...before,
    version: 2,
    economyMode: true,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  await waitFor(() => expect(select).toHaveBeenCalledWith("gpt-6-luna"));
});

it("lets the owner save a monthly pause and shows the resulting server state", async () => {
  vi.mocked(workspaceApi).mockImplementation(async (_path, method, body) => {
    if (method === "PATCH") {
      expect(body).toMatchObject({ monthlyLimitUsd: 0, dailyLimitUsd: 1 });
      return {
        ...spendingSummary,
        version: 2,
        monthlyLimitUsd: 0,
        monthlyRemainingUsd: 0,
        remainingUsd: 0,
        paused: true,
      };
    }
    return {
      ...spendingSummary,
      monthlyLimitUsd: 30,
      monthlySpentUsd: 0.1,
      monthlyRemainingUsd: 29.7,
      monthlyResetAt: "2026-10-01T00:00:00Z",
    };
  });
  render(<SpendingControls />);
  await openControls();
  const monthly = screen.getByLabelText("Monthly spending limit (USD)");
  fireEvent.change(monthly, { target: { value: "0" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save spending settings" }),
  );
  expect(
    await screen.findByText("Saved. Paid AI work is paused."),
  ).toBeInTheDocument();
  expect(monthly).toHaveValue("0.00");
});
