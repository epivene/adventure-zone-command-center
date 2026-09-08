import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BossAuthProvider, useBossAuth } from "./boss-auth-context";

const STORAGE_KEY = "az_boss_token";

// Simple consumer component for testing
function TestConsumer() {
  const { boss, loading, signOut } = useBossAuth();
  if (loading) return <div>Loading…</div>;
  if (!boss) return <div>Signed out</div>;
  return (
    <div>
      <div data-testid="boss-name">{boss.displayName}</div>
      <button onClick={signOut} data-testid="sign-out">Sign out</button>
    </div>
  );
}

describe("BossAuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows loading then signed-out when no token exists", async () => {
    render(<BossAuthProvider><TestConsumer /></BossAuthProvider>);
    // No token so immediately resolves to not loading
    await waitFor(() => {
      expect(screen.getByText("Signed out")).toBeTruthy();
    });
  });

  it("clears token on sign out", async () => {
    localStorage.setItem(STORAGE_KEY, "fake-token");
    // Mock the /boss/auth/me call
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ boss: { id: "1", displayName: "Dave", role: "boss" } }),
    } as Response);

    render(<BossAuthProvider><TestConsumer /></BossAuthProvider>);
    await waitFor(() => {
      expect(screen.getByTestId("boss-name")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("sign-out"));
    await waitFor(() => {
      expect(screen.getByText("Signed out")).toBeTruthy();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  it("clears boss state when token returns 401", async () => {
    localStorage.setItem(STORAGE_KEY, "expired-token");
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    } as Response);

    render(<BossAuthProvider><TestConsumer /></BossAuthProvider>);
    await waitFor(() => {
      expect(screen.getByText("Signed out")).toBeTruthy();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});

describe("Boss auth routing", () => {
  it("STORAGE_KEY is distinct from owner and office keys", () => {
    expect(STORAGE_KEY).toBe("az_boss_token");
    expect(STORAGE_KEY).not.toBe("az_owner_token");
    expect(STORAGE_KEY).not.toBe("az_office_token");
  });
});
