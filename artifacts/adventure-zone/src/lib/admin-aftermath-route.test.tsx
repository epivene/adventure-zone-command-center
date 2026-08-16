// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it } from "vitest";

import { ADMIN_AFTERMATH_PATH, ADMIN_WRAP_UP_PATH } from "./admin-aftermath-route";

describe("admin aftermath routing", () => {
  it("keeps an old nested wrap-up URL inside the aftermath area", () => {
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
