import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/auth-token", () => ({ apiGet }));

import { CallerFinder } from "./caller-finder";

function emptyResult() {
  return {
    exact: { kind: "none" as const },
    suggestions: [],
    canCreate: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("CallerFinder request pressure regression", () => {
  it("still searches when React verifies effects in Strict Mode", async () => {
    apiGet.mockResolvedValue(emptyResult());

    render(
      <StrictMode>
        <CallerFinder initialPhone="Patrick" onSelect={vi.fn()} />
      </StrictMode>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
  });

  it("keeps one request in flight and replaces queued input with the latest search", async () => {
    const first = deferred<ReturnType<typeof emptyResult>>();
    apiGet.mockImplementationOnce(() => first.promise);
    apiGet.mockResolvedValue(emptyResult());

    render(<CallerFinder initialPhone="Patr" onSelect={vi.fn()} />);

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Find caller"), {
      target: { value: "Patri" },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    fireEvent.change(screen.getByLabelText("Find caller"), {
      target: { value: "Patrick" },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    expect(apiGet).toHaveBeenCalledTimes(1);

    first.resolve(emptyResult());
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(apiGet).toHaveBeenLastCalledWith(
      "/calls/caller-finder?q=Patrick",
    );
  });
});
