// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagerAuthProvider, useManagerAuth } from "./manager-auth-context";

function Harness() {
  const { signIn } = useManagerAuth();
  return (
    <button type="button" onClick={() => { void signIn("leg-kristy", "manager-secret"); }}>
      Sign in manager
    </button>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("manager auth context", () => {
  it("submits manager credentials only to the manager login endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "manager-token",
          manager: { legId: "leg-kristy", legName: "Kristy", managerName: "Kristy" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <ManagerAuthProvider>
        <Harness />
      </ManagerAuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in manager" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/manager\/auth\/login$/);
    expect(String(url)).not.toMatch(/\/api\/auth\/login$/);
    expect(options).toMatchObject({
      method: "POST",
      body: JSON.stringify({ legId: "leg-kristy", password: "manager-secret" }),
    });
  });
});
