import { afterEach, describe, expect, it, vi } from "vitest";
import { readProfileReturnState, saveProfileReturnState } from "./profile-navigation";
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
