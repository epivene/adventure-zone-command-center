import { expect, it, vi } from "vitest";
import { runMailboxTurn, MailboxSyncLoop } from "./google-mailbox-sync-loop";
it("gives archives a bounded share even while thread hydration exhausts each turn", async () => {
  let time = 0, archived = 0, processed = 0;
  const account = { checkpoint: { phase: "ready" }, cohortLimit: 0 };
  const repo: any = {
    claimAccount: async () => account, current: async () => account,
    renew: async () => true, claimThreads: async () => [{}], release: async () => {},
  };
  await runMailboxTurn({repo, connectionId: "c", ingest: async () => {}, historyDue: false,
    now: () => time,
    archive: async () => { archived++; time += 1000; return true; },
    process: async () => { processed++; time += 10000; },
  });
  expect(archived).toBeGreaterThan(0);
  expect(archived).toBeLessThanOrEqual(10);
  expect(processed).toBeGreaterThan(0);
  expect(processed).toBeLessThanOrEqual(25);
});
it("exposes shutdown to the active turn and does not schedule another turn", async () => {
  vi.useFakeTimers();
  try {
    let stopped: (() => boolean) | undefined, finish!: () => void;
    const tick = vi.fn(async (check: () => boolean) => {
      stopped = check;
      await new Promise<void>((r) => (finish = r));
    });
    const loop = new MailboxSyncLoop(tick);
    loop.start();
    vi.advanceTimersByTime(0);
    expect(stopped).toBeTypeOf("function");
    const closing = loop.close();
    expect(stopped!()).toBe(true);
    finish();
    await closing;
    vi.advanceTimersByTime(60000);
    expect(tick).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("processes at most 25 jobs serially and yields remaining work for another turn", async () => {
  let remaining = 4000,
    processed = 0,
    active = 0,
    maxActive = 0,
    released = false;
  const account = { checkpoint: { phase: "ready" }, cohortLimit: 3 };
  const deferOutsideCohort = vi.fn(async () => 100);
  const repo: any = {
    deferOutsideCohort,
    claimAccount: async () => account,
    current: async () => account,
    renew: async () => true,
    claimThreads: async () => (remaining-- > 0 ? [{}] : []),
    release: async () => {
      released = true;
    },
  };
  const result = await runMailboxTurn({
    repo,
    connectionId: "c",
    ingest: async () => {},
    process: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      processed++;
      active--;
    },
    historyDue: false,
    now: () => 0,
  });
  expect(result.processed).toBe(25);
  expect(processed).toBe(25);
  expect(maxActive).toBe(1);
  expect(released).toBe(true);
  expect(deferOutsideCohort).toHaveBeenCalledOnce();
});
it("does not fetch or process anything when another worker owns the account", async () => {
  const result = await runMailboxTurn({
    repo: { claimAccount: async () => null } as any,
    connectionId: "c",
    ingest: async () => {
      throw Error("unexpected fetch");
    },
    process: async () => {
      throw Error("unexpected work");
    },
    historyDue: true,
  });
  expect(result.processed).toBe(0);
});
