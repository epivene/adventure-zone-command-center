import { expect, it } from "vitest";
import {
  scheduledGoogleFetch,
  withScheduledGoogleBudget,
} from "./google-scheduled-request-budget";
it("shares a two-request limit across clients in one scheduled owner", async () => {
  let active = 0,
    max = 0;
  const releases: (() => void)[] = [];
  const fake = async (_url: any, init: any) => {
    expect(init.signal).toBeDefined();
    active++;
    max = Math.max(max, active);
    await new Promise<void>((r) => releases.push(r));
    active--;
    return new Response("{}");
  };
  const a = scheduledGoogleFetch(fake as any),
    b = scheduledGoogleFetch(fake as any);
  await withScheduledGoogleBudget(async () => {
    const pending = [
      a("https://gmail.googleapis.com/1"),
      b("https://gmail.googleapis.com/2"),
      a("https://gmail.googleapis.com/3"),
    ];
    await new Promise((r) => setTimeout(r, 0));
    expect(active).toBe(2);
    releases.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(active).toBe(2);
    releases.splice(0).forEach((r) => r());
    await Promise.all(pending);
  });
  expect(max).toBe(2);
});
