import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionResults } from "./ActionResults";
it("shows independent failures without claiming everything completed", () => {
  render(
    <ActionResults
      items={[
        { id: "a1", label: "Email", status: "succeeded", href: "/email/1" },
        { id: "a2", label: "Profile update", status: "failed", href: null },
      ]}
    />,
  );
  expect(screen.getByText("Profile update")).toBeTruthy();
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(screen.queryByText("Everything completed")).toBeNull();
});
it("does not offer resend for uncertain delivery", () => {
  render(
    <ActionResults
      items={[{ id: "a1", label: "Email", status: "uncertain", href: null }]}
    />,
  );
  expect(screen.getByText("Checking result")).toBeTruthy();
  expect(screen.queryByText("Send again")).toBeNull();
});
