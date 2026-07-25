// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { OfflineBanner } from "@/components/connectivity/offline-banner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows connection-loss guidance while offline and hides after reconnecting", async () => {
  let online = false;
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => online);

  render(<OfflineBanner />);

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Offline — changes are drafts until reconnected",
  );

  online = true;
  window.dispatchEvent(new Event("online"));
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
});
