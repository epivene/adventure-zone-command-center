// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it } from "vitest";

import { MANAGER_PROTECTED_PATH } from "./App";

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
});
