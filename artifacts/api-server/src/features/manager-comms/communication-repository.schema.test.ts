import { describe, expect, it, vi } from "vitest";
import { CommunicationRepository } from "./communication-repository";

describe("CommunicationRepository schema initialization", () => {
  it("runs schema DDL only once after a successful initialization", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const repository = new CommunicationRepository({ execute } as never);

    await repository.ensureSchema();
    await repository.ensureSchema();
    await repository.ensureSchema();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("allows a later retry when schema initialization fails", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockResolvedValue({ rows: [] });
    const repository = new CommunicationRepository({ execute } as never);

    await expect(repository.ensureSchema()).rejects.toThrow("db unavailable");
    await expect(repository.ensureSchema()).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
  });
});
