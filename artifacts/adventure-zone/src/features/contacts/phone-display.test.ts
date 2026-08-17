import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, phoneHref } from "./phone-display";

describe("phone display", () => {
  it("formats ordinary US numbers", () => {
    expect(formatPhoneDisplay("9705473100")).toBe("(970) 547-3100");
    expect(formatPhoneDisplay("1-970-547-3100")).toBe("(970) 547-3100");
    expect(formatPhoneDisplay("+1 (970) 547-3100")).toBe("(970) 547-3100");
    expect(phoneHref("(970) 547-3100")).toBe("tel:+19705473100");
  });

  it("preserves extension and international values safely", () => {
    expect(formatPhoneDisplay("970-547-3100 ext 22")).toBe("970-547-3100 ext 22");
    expect(formatPhoneDisplay("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("returns null for blank phone values", () => {
    expect(formatPhoneDisplay(null)).toBeNull();
    expect(formatPhoneDisplay("   ")).toBeNull();
    expect(phoneHref(undefined)).toBeNull();
  });
});
