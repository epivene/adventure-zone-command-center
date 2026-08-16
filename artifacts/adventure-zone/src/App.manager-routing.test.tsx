// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it } from "vitest";

import { MANAGER_PROTECTED_PATH } from "@/lib/manager-route-pattern";
import { ADMIN_AFTERMATH_PATH, ADMIN_WRAP_UP_PATH } from "@/lib/admin-aftermath-route";

describe("manager protected routing", () => {
  it("keeps manager sub-routes inside the manager router", () => {
    const { hook } = memoryLocation({ path: "/manager/route", static: true });

    render(
      <Router hook={hook}>
        <Switch>
          <Route path={MANAGER_PROTECTED_PATH}>Manager protected area</Route>
          <Route>Owner fallback</Route>
        </Switch>
      </Router>,
    );

    expect(screen.getByText("Manager protected area")).toBeInTheDocument();
    expect(screen.queryByText("Owner fallback")).not.toBeInTheDocument();
  });

  it("keeps nested admin wrap-up URLs inside aftermath instead of falling to 404", () => {
    const { hook } = memoryLocation({ path: "/manager-aftermath/wrap-ups/booking-123", static: true });

    render(
      <Router hook={hook}>
        <Switch>
          <Route path={ADMIN_WRAP_UP_PATH}>Wrap-up detail</Route>
          <Route path={ADMIN_AFTERMATH_PATH}>Aftermath list</Route>
          <Route>Not found</Route>
        </Switch>
      </Router>,
    );

    expect(screen.getByText("Wrap-up detail")).toBeInTheDocument();
    expect(screen.queryByText("Not found")).not.toBeInTheDocument();
  });
});
