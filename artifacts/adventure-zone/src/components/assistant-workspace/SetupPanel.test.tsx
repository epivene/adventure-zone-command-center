import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SetupPanel } from "./SetupPanel";
const status = {
  enabled: false,
  ready: false,
  model: null,
  models: [],
  providerVerification: "not_checked" as const,
  checks: [
    {
      id: "configuration",
      label: "OpenAI configuration",
      state: "needs_setup" as const,
      required: true,
      message: "Add missing server settings.",
      keys: ["ASSISTANT_OPENAI_MODEL"],
    },
    {
      id: "gmail",
      label: "Company Gmail",
      state: "needs_setup" as const,
      required: false,
      message: "Reconnect company Gmail.",
      href: "/settings/google-workspace",
    },
  ],
};
it("shows required setup separately from optional connections and exposes a refresh action", () => {
  let refreshed = false;
  render(
    <SetupPanel
      status={status}
      refreshing={false}
      onRefresh={() => {
        refreshed = true;
      }}
    />,
  );
  expect(screen.getByText("Add missing server settings.")).toBeTruthy();
  expect(
    screen.getByText("ASSISTANT_OPENAI_MODEL", { selector: "code" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Google settings" }).getAttribute("href"),
  ).toBe("/settings/google-workspace");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh setup status" }));
  expect(refreshed).toBe(true);
});
it("labels provider access as unverified even when local chat is ready", () => {
  render(
    <SetupPanel
      status={{ ...status, enabled: true, ready: true }}
      refreshing={true}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByText(/OpenAI access has not been tested/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Refreshing setup status…" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("keeps ready setup collapsed while refresh remains available", () => {
  const refresh = vi.fn();
  const view = render(
    <SetupPanel
      status={{ ...status, enabled: true, ready: true }}
      refreshing={false}
      onRefresh={refresh}
    />,
  );
  expect(view.container.querySelector("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Refresh setup status" }));
  expect(refresh).toHaveBeenCalledOnce();
  view.rerender(
    <SetupPanel status={status} refreshing={false} onRefresh={refresh} />,
  );
  expect(view.container.querySelector("details")?.open).toBe(true);
  expect(screen.getByText("Finish connecting your assistant")).toBeVisible();
});
