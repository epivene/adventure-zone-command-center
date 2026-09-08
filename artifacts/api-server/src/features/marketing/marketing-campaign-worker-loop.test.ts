import { describe, expect, it, vi } from "vitest";
import { MarketingCampaignWorkerLoop } from "./marketing-campaign-worker-loop";

describe("MarketingCampaignWorkerLoop", () => {
  it("does not dispatch before start and prevents overlapping polls", async () => {
    let resolve!: () => void;
    const dispatchDue = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const loop = new MarketingCampaignWorkerLoop({ dispatchDue } as any, vi.fn(), 1);
    expect(dispatchDue).not.toHaveBeenCalled();
    loop.start();
    expect(dispatchDue).toHaveBeenCalledTimes(1);
    await new Promise((done) => setTimeout(done, 5));
    expect(dispatchDue).toHaveBeenCalledTimes(1);
    resolve();
    await loop.close();
  });
});