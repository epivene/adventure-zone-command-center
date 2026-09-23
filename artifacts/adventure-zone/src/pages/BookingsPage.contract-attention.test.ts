import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import BookingsPage from "./BookingsPage";

describe("retired contract attention queue", () => {
  it("redirects the old focused queue to Profiles", async () => {
    const { hook } = memoryLocation({ path: "/bookings?attention=contracts" });

    render(
      <Router hook={hook}>
        <BookingsPage />
        <Route path="/profiles">
          <p>Profiles workspace</p>
        </Route>
      </Router>,
    );

    expect(await screen.findByText("Profiles workspace")).toBeVisible();
    expect(screen.queryByText(/contracts needing attention/i)).not.toBeInTheDocument();
  });
});
