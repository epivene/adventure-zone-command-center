import { describe, expect, it, vi } from "vitest";
import { GOOGLE_DOCUMENT_INTERVAL_MS, GoogleDocumentWorkerLoop, type GoogleDocumentWorkerLoopScheduler } from "./google-document-worker-loop";

class Scheduler implements GoogleDocumentWorkerLoopScheduler {
  rows: Array<{ task: () => void; delay: number; cancelled: boolean }> = [];
  schedule(task: () => void, delay: number) { const row = { task, delay, cancelled: false }; this.rows.push(row); return row; }
  cancel(handle: unknown) { (handle as any).cancelled = true; }
  run(index: number) { this.rows[index]!.task(); }
}
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("GoogleDocumentWorkerLoop", () => {
  it('defers document intake while another Gmail owner is working',async()=>{
    const scheduler=new Scheduler();const runOnce=vi.fn();
    const loop=new GoogleDocumentWorkerLoop({worker:{runOnce},clock:{now:()=>new Date()},scheduler,runExclusive:async()=>{}});
    loop.start();scheduler.run(0);await settle();expect(runOnce).not.toHaveBeenCalled();expect(scheduler.rows).toHaveLength(2);await loop.close();
  });
  it("waits one hour after a run settles and never overlaps runs", async () => {
    let resolve!: () => void;
    const runOnce = vi.fn(async () => { await new Promise<void>((done) => { resolve = done; }); return {} as any; });
    const scheduler = new Scheduler();
    const loop = new GoogleDocumentWorkerLoop({ worker: { runOnce }, clock: { now: () => new Date() }, scheduler });
    loop.start();
    scheduler.run(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(scheduler.rows).toHaveLength(1);
    scheduler.run(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolve();
    await settle();
    expect(scheduler.rows[1]?.delay).toBe(GOOGLE_DOCUMENT_INTERVAL_MS);
    await loop.close();
  });

  it("continues scheduling after a failed run", async () => {
    const scheduler = new Scheduler();
    const loop = new GoogleDocumentWorkerLoop({ worker: { runOnce: vi.fn().mockRejectedValue(new Error("temporary")) }, clock: { now: () => new Date() }, scheduler });
    loop.start(); scheduler.run(0); await settle();
    expect(scheduler.rows[1]?.delay).toBe(GOOGLE_DOCUMENT_INTERVAL_MS);
    await loop.close();
  });
});
