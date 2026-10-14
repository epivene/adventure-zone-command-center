import { afterEach, expect, it, vi } from "vitest";
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiFetch }));
import { mailboxError, mailboxRequest } from "./mailbox-client";
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
function limited(seconds: number) {
  return { ok: false, headers: new Headers({ "Retry-After": String(seconds) }), json: async () => ({ error: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED", retryAfterSeconds: seconds }) };
}
it("honors the Gmail delay across folders and allows a retry after it expires", async () => {
  vi.useFakeTimers();
  apiFetch.mockResolvedValueOnce(limited(120)).mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }) });
  await expect(mailboxRequest("?folder=inbox&connectionId=one")).rejects.toMatchObject({ retryAfterSeconds: 120 });
  await expect(mailboxRequest("?folder=sent&connectionId=one")).rejects.toMatchObject({ retryAfterSeconds: 120 });
  expect(apiFetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(120000);
  await expect(mailboxRequest("?folder=inbox&connectionId=one")).resolves.toEqual({ messages: [] });
  expect(apiFetch).toHaveBeenCalledTimes(2);
});
it("does not block other accounts or local profile search", async () => {
  apiFetch.mockResolvedValueOnce(limited(60)).mockResolvedValue({ ok: true, json: async () => ({}) });
  await expect(mailboxRequest("?connectionId=two")).rejects.toThrow("RATE_LIMITED");
  await mailboxRequest("?connectionId=three");
  await mailboxRequest("/profiles?query=Blanding");
  expect(apiFetch).toHaveBeenCalledTimes(3);
});
it("never automatically retries mutations", async () => {
  apiFetch.mockResolvedValue(limited(60));
  await expect(mailboxRequest("/drafts/example/send", { connectionId: "four", confirm: true })).rejects.toThrow("RATE_LIMITED");
  expect(apiFetch).toHaveBeenCalledTimes(1);
});
it("explains rate limits separately from expired permissions", () => {
  expect(mailboxError(Object.assign(new Error("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED"), { retryAfterSeconds: 120 }))).toContain("2 minutes");
  expect(mailboxError(new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"))).toContain("Reconnect");
});
