import { afterEach, describe, expect, it, vi } from "vitest";
import { readProfileReturnState, saveProfileReturnState, profileReturnPath } from "./profile-navigation";
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });
describe("profile return navigation", () => {
  it("preserves filtered directory location and scroll", () => {
    saveProfileReturnState("/profiles?q=fair&region=CO&page=3", 850);
    expect(readProfileReturnState()).toEqual({ path: "/profiles?q=fair&region=CO&page=3", scrollY: 850 });
  });
  it("rejects external and malformed returns", () => {
    for (const path of ["https://example.com", "//example.com", "/\\example.com"]) {
      saveProfileReturnState(path, 50);
      expect(readProfileReturnState()).toBeNull();
    }
  });
  it("works when session storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("denied"); });
    expect(() => saveProfileReturnState("/profiles", 10)).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("denied"); });
    expect(readProfileReturnState()).toBeNull();
  });
});

it("uses the link return target and ignores stale directory history for direct links",()=>{
  saveProfileReturnState("/profiles?q=old", 500);
  expect(profileReturnPath("?returnTo=%2Ftoday")).toBe("/today");
  expect(profileReturnPath("")).toBe("/profiles");
  expect(profileReturnPath("?returnTo=https%3A%2F%2Fevil.example")).toBe("/profiles");
});
