import { beforeEach, describe, expect, it } from "vitest";

import {
  clearTodayReturnContext,
  readTodayReturnContext,
  saveTodayReturnContext,
} from "./today-return-context";

const STORAGE_KEY = "adventure-zone:today-return-context";

beforeEach(() => sessionStorage.clear());

describe("Today return context", () => {
  it("round-trips valid navigation state", () => {
    const context = { filter: "active", workItemId: "work-17", scrollY: 428 };
    saveTodayReturnContext(context);
    expect(readTodayReturnContext()).toEqual(context);
  });

  it.each([
    "{not-json",
    JSON.stringify({ filter: null, workItemId: null, scrollY: -1 }),
    JSON.stringify({ filter: null, workItemId: null, scrollY: "10" }),
    JSON.stringify({ filter: null, workItemId: null, scrollY: 10, extra: true }),
    JSON.stringify({ filter: 5, workItemId: null, scrollY: 10 }),
  ])("returns null for invalid stored state", (stored) => {
    sessionStorage.setItem(STORAGE_KEY, stored);
    expect(readTodayReturnContext()).toBeNull();
  });

  it("rejects non-finite scroll positions before writing", () => {
    expect(() =>
      saveTodayReturnContext({ filter: null, workItemId: null, scrollY: Infinity }),
    ).not.toThrow();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears the saved context", () => {
    saveTodayReturnContext({ filter: null, workItemId: null, scrollY: 0 });
    clearTodayReturnContext();
    expect(readTodayReturnContext()).toBeNull();
  });
});
