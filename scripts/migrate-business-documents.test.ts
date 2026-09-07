import { describe, expect, it, vi } from "vitest";
import { parseMigrationArgs, runMigrationCli } from "./migrate-business-documents";

describe("migrate-business-documents CLI", () => {
  it("is preview-only unless --apply is explicit", () => {
    expect(parseMigrationArgs([])).toMatchObject({ dryRun: true, batchSize: 100, afterId: null });
    expect(parseMigrationArgs(["--apply", "--batch-size=25", "--after-id=cursor-1"]))
      .toEqual({ dryRun: false, batchSize: 25, afterId: "cursor-1" });
  });

  it("passes an apply run to the migration only after --apply", async () => {
    const runner = vi.fn(async () => ({ imported: 3 }));
    const output = vi.fn();
    await runMigrationCli(["--apply"], { DATABASE_URL: "postgres://test" }, output, runner);
    expect(runner).toHaveBeenCalledWith({ dryRun: false, batchSize: 100, afterId: null });
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"imported": 3'));
  });

  it("refuses a live run without a database", async () => {
    await expect(runMigrationCli(["--apply"], {}, vi.fn(), vi.fn())).rejects.toThrow("DATABASE_URL is required");
  });
});
