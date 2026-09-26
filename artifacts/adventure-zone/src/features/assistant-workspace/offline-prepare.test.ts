import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Conversation, Rule } from "./types";
const state = vi.hoisted(() => ({
  record: null as any,
  storageFails: false,
  shellFails: false,
  shellReady: true,
}));
vi.mock("./offline-db", () => ({
  readOfflineRecord: async () => structuredClone(state.record),
  changeOfflineRecord: async (change: any) => {
    const result = change(structuredClone(state.record));
    if (state.storageFails) throw new Error("Quota exceeded");
    state.record = structuredClone(result.record);
    return result.value;
  },
}));
vi.mock("@/lib/offline/workspace-shell", () => ({
  prepareOfflineShell: async () => {
    if (state.shellFails) throw new Error("Asset failed");
  },
  isOfflineShellReady: async () => state.shellReady,
}));
import { prepareOfflineWorkspace } from "./offline-prepare";
import { loadOfflineWorkspace } from "./offline-store";
const conversation: Conversation = {
  id: "c1",
  title: "Fair",
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
  drafts: [],
  runs: [],
};
const rule = (id: string, changes: Partial<Rule> = {}): Rule => ({
  id,
  ruleKey: id,
  body: "Approved terms",
  version: 1,
  status: "approved",
  sourceLabel: "Owner",
  organizationId: null,
  eventYear: null,
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  reviewedAt: "2026-09-25",
  ...changes,
});
let authorized: boolean, changed: boolean;
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  state.record = null;
  state.storageFails = false;
  state.shellFails = false;
  state.shellReady = true;
  authorized = true;
  changed = false;
  localStorage.setItem("az_owner_token", `owner.${Date.now() + 86400000}.sig`);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (init.method && init.method !== "GET")
      throw new Error("Preparation must be read-only");
    if (url.endsWith("/auth/me"))
      return new Response(
        JSON.stringify(
          authorized
            ? { ok: true, role: "owner" }
            : { ok: true, role: "manager" },
        ),
      );
    if (url.endsWith("/conversations/c1"))
      return new Response(JSON.stringify(conversation));
    if (url.endsWith("/knowledge"))
      return new Response(
        JSON.stringify([
          rule("global"),
          rule("selected", { organizationId: "org1", eventYear: 2026 }),
          rule("other", { organizationId: "org2" }),
          rule("draft", { status: "proposed" }),
          rule("expired", { effectiveTo: "2020-01-02" }),
        ]),
      );
    if (url.endsWith("/organizations/org1")) {
      if (changed)
        localStorage.setItem(
          "az_owner_token",
          `owner.${Date.now() + 86400000}.other`,
        );
      return new Response(
        JSON.stringify({
          organization: {
            id: "org1",
            name: "County Fair",
            contacts: [
              { name: "Jordan", email: "j@example.com", phone: "555" },
            ],
            bookings: [],
            profileImageDataUrl: "data:image/png;base64,secret",
          },
          timeline: [],
          orgLocations: [
            {
              id: "location-id",
              label: "Fairgrounds",
              venueName: "Main Hall",
              city: "Portland",
              region: "OR",
            },
          ],
        }),
      );
    }
    throw new Error(`Unexpected read ${url}`);
  });
});
it("prepares verified current records with applicable approved rules and no image bytes", async () => {
  const result = await prepareOfflineWorkspace("c1");
  expect(result.profiles[0]).toMatchObject({ id: "org1", name: "County Fair" });
  expect(result.profiles[0].details.Locations).toBe(
    "Fairgrounds · Main Hall · Portland · OR",
  );
  expect(result.rules.map((entry) => entry.id)).toEqual(["global", "selected"]);
  expect(JSON.stringify(state.record)).not.toContain("data:image");
  expect((await loadOfflineWorkspace()).snapshots).toHaveLength(1);
});
it("requires a verified online owner before persisting records", async () => {
  authorized = false;
  await expect(prepareOfflineWorkspace("c1")).rejects.toThrow(/owner|sign in/i);
  expect(state.record).toBeNull();
});
it("does not mark partial shell preparation as ready", async () => {
  state.shellFails = true;
  await expect(prepareOfflineWorkspace("c1")).rejects.toThrow("Asset failed");
  expect(state.record).toBeNull();
});
it("does not report ready when device storage cannot commit", async () => {
  state.storageFails = true;
  await expect(prepareOfflineWorkspace("c1")).rejects.toThrow("Quota exceeded");
  expect(state.record).toBeNull();
});
it("refuses ready after cache eviction or an owner change during preparation", async () => {
  state.shellReady = false;
  await expect(prepareOfflineWorkspace("c1")).rejects.toThrow(/asset|shell/i);
  state.shellReady = true;
  changed = true;
  await expect(prepareOfflineWorkspace("c1")).rejects.toThrow(
    /locked|owner|sign in/i,
  );
  expect((await loadOfflineWorkspace()).snapshots).toEqual([]);
});
