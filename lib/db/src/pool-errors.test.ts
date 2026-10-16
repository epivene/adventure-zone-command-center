import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("handles idle connection failures without crashing the API", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  // pg does not connect until a query is issued. Exercise the real pool's event boundary.
  vi.stubEnv("RENDER_DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { pool, gmailThreadLockPool } = await import("./index");
  try {
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
    expect(() => gmailThreadLockPool.emit("error", new Error("connection closed"))).not.toThrow();
    expect(log).toHaveBeenCalled();
  } finally {
    await pool.end(); await gmailThreadLockPool.end();
  }
});
