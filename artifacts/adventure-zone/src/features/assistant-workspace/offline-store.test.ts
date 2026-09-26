import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Conversation, Draft } from "./types";
const persistence = vi.hoisted(() => ({ record: null as any, fail: false }));
vi.mock("./offline-db", () => ({
  readOfflineRecord: async () => structuredClone(persistence.record),
  changeOfflineRecord: async (change: any) => {
    const result = change(structuredClone(persistence.record));
    if (persistence.fail) throw new Error("Storage full");
    persistence.record = structuredClone(result.record);
    return result.value;
  },
}));
import {
  getOfflineBinding,
  commitPreparedSnapshot,
  loadOfflineWorkspace,
  saveOfflineDraft,
  offlineDraftVersion,
  clearOfflineWorkspace,
  discardOfflineDraft,
} from "./offline-store";
export const draft: Draft = {
  id: "d1",
  revision: "r1",
  status: "local",
  gmailDraftId: null,
  content: {
    to: ["a@example.com"],
    cc: [],
    subject: "Original",
    html: "<table><tr><td>Hello</td></tr></table>",
    text: "Hello",
    threadId: "thread",
    attachmentIds: ["attachment"],
    templateId: "template",
    templateVersion: "v1",
  },
};
export const conversation = (id = "c1"): Conversation => ({
  id,
  title: "Prepared fair",
  version: 1,
  selection: {
    organizationIds: ["org1"],
    bookingId: null,
    threadId: null,
    draftId: null,
    eventYear: 2026,
  },
  messages: [],
  actions: [],
  drafts: [draft],
  runs: [],
});
const edits = {
  subject: "On this phone",
  html: "<table><tr><td>Offline edit</td></tr></table>",
  text: "Offline edit",
};
function version(id = "c1") {
  return offlineDraftVersion(
    persistence.record.snapshots.find(
      (item: any) => item.conversation.id === id,
    ).drafts[0],
  );
}
async function prepare(id = "c1") {
  return commitPreparedSnapshot(await getOfflineBinding(), {
    conversation: conversation(id),
    profiles: [],
    rules: [],
  });
}
beforeEach(() => {
  persistence.record = null;
  persistence.fail = false;
  vi.useRealTimers();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("indexedDB", {});
  localStorage.clear();
  localStorage.setItem(
    "az_owner_token",
    `owner.${Date.now() + 30 * 86400000}.signature`,
  );
});
describe("offline saved records", () => {
  it("isolates snapshots by token digest and locks them at expiry without persisting a raw token", async () => {
    await prepare();
    expect((await loadOfflineWorkspace()).snapshots).toHaveLength(1);
    expect(JSON.stringify(persistence.record)).not.toContain(
      localStorage.getItem("az_owner_token"),
    );
    localStorage.setItem(
      "az_owner_token",
      `owner.${Date.now() + 86400000}.different`,
    );
    expect((await loadOfflineWorkspace()).snapshots).toEqual([]);
  });
  it("expires saved access after seven days, preserving pending edits when explicitly prepared again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    localStorage.setItem(
      "az_owner_token",
      `owner.${Date.now() + 30 * 86400000}.signature`,
    );
    await prepare();
    await saveOfflineDraft("c1", "d1", edits, version());
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    expect((await loadOfflineWorkspace()).snapshots).toEqual([]);
    await prepare();
    expect((await loadOfflineWorkspace()).snapshots[0].drafts[0]).toMatchObject(
      { base: { revision: "r1" }, local: edits },
    );
  });
  it("honors token expiry sooner than snapshot expiry", async () => {
    vi.useFakeTimers();
    localStorage.setItem(
      "az_owner_token",
      `owner.${Date.now() + 1000}.signature`,
    );
    await prepare();
    vi.advanceTimersByTime(1001);
    expect((await loadOfflineWorkspace()).snapshots).toEqual([]);
  });
  it("preserves template, recipients, attachments and the first revision through refresh", async () => {
    await prepare();
    await saveOfflineDraft("c1", "d1", edits, version());
    const fresh = conversation();
    fresh.drafts = [
      {
        ...draft,
        revision: "r2",
        content: { ...draft.content, subject: "Changed online" },
      },
    ];
    await commitPreparedSnapshot(await getOfflineBinding(), {
      conversation: fresh,
      profiles: [],
      rules: [],
    });
    const saved = (await loadOfflineWorkspace()).snapshots[0].drafts[0];
    expect(saved).toMatchObject({
      base: {
        revision: "r1",
        content: {
          to: ["a@example.com"],
          attachmentIds: ["attachment"],
          templateId: "template",
        },
      },
      local: edits,
    });
  });
  it("rejects a failed write without replacing prior saved edits", async () => {
    await prepare();
    persistence.fail = true;
    await expect(
      saveOfflineDraft("c1", "d1", edits, version()),
    ).rejects.toThrow("Storage full");
    expect(
      (await loadOfflineWorkspace()).snapshots[0].drafts[0].local,
    ).toBeNull();
  });
  it("keeps ten conversations without evicting pending drafts", async () => {
    for (let index = 0; index < 10; index++) {
      await prepare(`c${index}`);
      await saveOfflineDraft(`c${index}`, "d1", edits, version(`c${index}`));
    }
    await expect(prepare("eleventh")).rejects.toThrow(/pending|unsynced/i);
    expect((await loadOfflineWorkspace()).snapshots).toHaveLength(10);
  });
  it("discards only the selected local draft after explicit reconciliation", async () => {
    await prepare();
    await saveOfflineDraft("c1", "d1", edits, version());
    await discardOfflineDraft("c1", "d1", version());
    expect((await loadOfflineWorkspace()).snapshots[0].drafts[0]).toMatchObject(
      { local: null, syncState: "idle", base: { revision: "r1" } },
    );
  });
  it("rejects a stale editor save without overwriting another tab's work", async () => {
    await prepare();
    const opened = version();
    await saveOfflineDraft("c1", "d1", edits, opened);
    await expect(
      saveOfflineDraft("c1", "d1", { ...edits, subject: "Stale tab" }, opened),
    ).rejects.toThrow(/another tab/);
    expect((await loadOfflineWorkspace()).snapshots[0].drafts[0].local).toEqual(
      edits,
    );
  });
  it("rejects a stale discard and compares content when timestamps match", async () => {
    vi.useFakeTimers();
    await prepare();
    await saveOfflineDraft("c1", "d1", edits, version());
    const opened = version();
    const newer = { ...edits, text: "Newer local work" };
    await saveOfflineDraft("c1", "d1", newer, opened);
    await expect(discardOfflineDraft("c1", "d1", opened)).rejects.toThrow(
      /another tab/,
    );
    expect((await loadOfflineWorkspace()).snapshots[0].drafts[0].local).toEqual(
      newer,
    );
  });
  it("clears every local snapshot on explicit removal", async () => {
    await prepare();
    await clearOfflineWorkspace();
    expect((await loadOfflineWorkspace()).snapshots).toEqual([]);
  });
});
