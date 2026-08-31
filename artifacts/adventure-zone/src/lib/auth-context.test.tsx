// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup = vi.hoisted(() => ({
  assistant: vi.fn().mockResolvedValue(undefined),
  workspace: vi.fn(),
}));

vi.mock("@/features/assistant/assistant-offline-cache", () => ({
  clearAssistantCacheForActor: cleanup.assistant,
}));
vi.mock("@/lib/admin-workspace", () => ({
  clearBookingReturnPath: cleanup.workspace,
}));

import { AuthProvider, useAuth } from "./auth-context";

const owner = {
  id: "30000000-0000-4000-8000-000000000001",
  displayName: "Desiree",
  role: "owner" as const,
};

function Harness() {
  const { owner: currentOwner, signIn, signOutAll } = useAuth();
  return (
    <div>
      <p>{currentOwner ? `${currentOwner.displayName}:${currentOwner.role}` : "No owner"}</p>
      <button type="button" onClick={() => { void signIn("owner-secret"); }}>
        Sign in owner
      </button>
      <button type="button" onClick={() => { void signOutAll(); }}>
        Sign out all owner devices
      </button>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup.assistant.mockClear();
  cleanup.workspace.mockClear();
  localStorage.clear();
});

describe("owner auth context", () => {
  it("stores the returned owner identity and revokes every owner token through the owner endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ token: "owner-token", owner }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in owner" }));
    await screen.findByText("Desiree:owner");

    const [loginUrl, loginOptions] = fetchMock.mock.calls[0]!;
    expect(String(loginUrl)).toMatch(/\/api\/auth\/login$/);
    expect(loginOptions).toMatchObject({
      method: "POST",
      body: JSON.stringify({ password: "owner-secret" }),
    });
    expect(localStorage.getItem("az_owner_token")).toBe("owner-token");

    fireEvent.click(screen.getByRole("button", { name: "Sign out all owner devices" }));
    await screen.findByText("No owner");

    const [revokeUrl, revokeOptions] = fetchMock.mock.calls[1]!;
    expect(String(revokeUrl)).toMatch(/\/api\/auth\/sign-out-all$/);
    expect(revokeOptions).toMatchObject({ method: "POST" });
    expect(new Headers(revokeOptions?.headers).get("Authorization")).toBe("Bearer owner-token");
    expect(localStorage.getItem("az_owner_token")).toBeNull();
    await waitFor(() => expect(cleanup.assistant).toHaveBeenCalledOnce());
    expect(cleanup.workspace).toHaveBeenCalledOnce();
  });

  it("restores the stable owner identity from a stored token", async () => {
    localStorage.setItem("az_owner_token", "stored-owner-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, role: "owner", owner }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await screen.findByText("Desiree:owner");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/auth\/me$/);
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer stored-owner-token");
  });
});
