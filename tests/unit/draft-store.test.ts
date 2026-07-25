// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteDraft,
  loadDraft,
  saveDraft,
} from "@/lib/offline/draft-store";

describe("booking draft storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("round-trips a locally saved booking draft", () => {
    saveDraft("booking:new", { name: "Draft Fair", city: "Fargo" });

    expect(loadDraft("booking:new")).toEqual({
      name: "Draft Fair",
      city: "Fargo",
    });
  });

  it("stores a versioned, timestamped record in the app namespace", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T15:30:00.000Z"));

    expect(saveDraft("booking:new", { name: "Draft Fair" })).toEqual({
      ok: true,
    });
    expect(localStorage.getItem("azcc:draft:booking:new")).toBe(
      JSON.stringify({
        version: 1,
        savedAt: "2026-07-25T15:30:00.000Z",
        data: { name: "Draft Fair" },
      }),
    );
  });

  it("returns a typed failure when the browser cannot serialize the draft", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(saveDraft("booking:new", circular)).toEqual({
      ok: false,
      error: "serialization_failed",
    });
    expect(localStorage.getItem("azcc:draft:booking:new")).toBeNull();
  });

  it("returns a typed failure when local storage rejects the write", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

    expect(saveDraft("booking:new", { name: "Draft Fair" })).toEqual({
      ok: false,
      error: "storage_unavailable",
    });
    setItem.mockRestore();
  });

  it("ignores corrupt or incompatible records", () => {
    localStorage.setItem("azcc:draft:booking:new", "{bad json");
    expect(loadDraft("booking:new")).toBeNull();

    localStorage.setItem(
      "azcc:draft:booking:new",
      JSON.stringify({ version: 99, savedAt: "yesterday", data: { name: "Old" } }),
    );
    expect(loadDraft("booking:new")).toBeNull();
  });

  it("deletes only the requested namespaced draft", () => {
    saveDraft("booking:new", { name: "New" });
    saveDraft("booking:edit:123", { name: "Edit" });

    expect(deleteDraft("booking:new")).toEqual({ ok: true });
    expect(loadDraft("booking:new")).toBeNull();
    expect(loadDraft("booking:edit:123")).toEqual({ name: "Edit" });
  });
});
