import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BOOKING_RETURN_STORAGE_KEY,
  adminWorkspaceForPath,
  clearBookingReturnPath,
  isBookingPath,
  readBookingReturnPath,
  saveBookingReturnPath,
} from "./admin-workspace";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("admin workspace routing", () => {
  it.each([
    ["/command", "command"],
    ["/today", "booking"],
    ["/profiles/abc", "booking"],
    ["/organizations", "booking"],
    ["/event-families/abc", "booking"],
    ["/event-profiles/abc", "booking"],
    ["/contacts", "booking"],
    ["/bookings/abc", "booking"],
    ["/schedule", "booking"],
    ["/calendar", "booking"],
    ["/calls/workspace", "booking"],
    ["/research-sources", "booking"],
    ["/needs-answer", "booking"],
    ["/quick-add", "booking"],
    ["/office-coordinator", "booking"],
    ["/routes", "operations"],
    ["/trips/abc", "operations"],
    ["/manager-communications", "operations"],
    ["/manager-finance", "operations"],
    ["/manager-crew", "operations"],
    ["/manager-aftermath", "operations"],
    ["/manager-issues", "operations"],
    ["/marketing", "marketing"],
    ["/marketing/campaigns", "marketing"],
    ["/settings", "admin"],
    ["/settings/paper-notes", "admin"],
    ["/act-migration", "admin"],
    ["/something-unclassified", "admin"],
  ] as const)("classifies %s as %s", (path, expected) => {
    expect(adminWorkspaceForPath(path)).toBe(expected);
  });

  it("ignores query/hash when classifying", () => {
    expect(adminWorkspaceForPath("/profiles/abc?tab=notes#top")).toBe("booking");
  });
});

describe("Booking return path", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => {
    storage.clear();
  });

  it("stores and reads valid Booking paths", () => {
    expect(saveBookingReturnPath("/profiles/abc?tab=notes", storage)).toBe(true);
    expect(storage.getItem(BOOKING_RETURN_STORAGE_KEY)).toBe("/profiles/abc?tab=notes");
    expect(readBookingReturnPath(storage)).toBe("/profiles/abc?tab=notes");
  });

  it.each(["/routes", "/settings", "/marketing", "https://example.com", "//example.com/evil", "profiles/no-leading-slash"])(
    "rejects invalid return destination %s",
    (path) => {
      expect(saveBookingReturnPath(path, storage)).toBe(false);
      expect(readBookingReturnPath(storage)).toBeNull();
    },
  );

  it("rejects a stale non-Booking value already in storage", () => {
    storage.setItem(BOOKING_RETURN_STORAGE_KEY, "/manager-finance");
    expect(readBookingReturnPath(storage)).toBeNull();
  });

  it("clears the stored destination", () => {
    saveBookingReturnPath("/today", storage);
    clearBookingReturnPath(storage);
    expect(readBookingReturnPath(storage)).toBeNull();
  });

  it("recognizes only Booking paths", () => {
    expect(isBookingPath("/calls/workspace")).toBe(true);
    expect(isBookingPath("/marketing")).toBe(false);
  });
});
