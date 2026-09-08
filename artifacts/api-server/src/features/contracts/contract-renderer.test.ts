import { describe, expect, it } from "vitest";

import { guaranteePlusPercentageSnapshot } from "./fixtures/guarantee-plus-percentage.snapshot";
import { guaranteedFeeSnapshot } from "./fixtures/guaranteed-fee.snapshot";
import { payForPlaySnapshot } from "./fixtures/pay-for-play.snapshot";
import { renderContract } from "./contract-renderer";

describe("renderContract", () => {
  it("renders pay-for-play terms without guaranteed-fee wording", () => {
    const rendered = renderContract(payForPlaySnapshot);
    expect(rendered.text).toContain("10% of ticket-box sales");
    expect(rendered.text).toContain("within 24 hours of the last operating day");
    expect(rendered.text).not.toContain("$5,000.00 guaranteed event fee");
  });

  it("renders guaranteed fee arithmetic and dates", () => {
    const rendered = renderContract(guaranteedFeeSnapshot);
    expect(rendered.text).toContain("$5,000.00 guaranteed event fee");
    expect(rendered.text).toContain("$2,500.00 deposit due March 6, 2026");
    expect(rendered.text).toContain("$2,500.00 balance upon arrival in September");
    expect(rendered.text).not.toContain("ticket-box sales above");
  });

  it("renders both reviewed components and an explicit base for the hybrid arrangement", () => {
    const rendered = renderContract(guaranteePlusPercentageSnapshot);
    expect(rendered.text).toContain("$3,000.00 guaranteed event fee");
    expect(rendered.text).toContain("5% of gross ticket-box sales above $8,000");
  });

  it("places the event representative before Dave and includes date lines", () => {
    const rendered = renderContract(guaranteedFeeSnapshot);
    expect(rendered.text.indexOf("Pat Organizer")).toBeLessThan(rendered.text.indexOf("Dave Gordon"));
    expect(rendered.signatureBlocks).toEqual([
      expect.objectContaining({ name: "Pat Organizer", order: 1, hasDateLine: true }),
      expect.objectContaining({ name: "Dave Gordon", order: 2, hasDateLine: true }),
    ]);
  });

  it("escapes user-entered HTML and produces stable output", () => {
    const values = { ...guaranteedFeeSnapshot, eventName: "Kids <Fun> & Fair" };
    const first = renderContract(values);
    expect(first.html).toContain("Kids &lt;Fun&gt; &amp; Fair");
    expect(first.html).not.toContain("Kids <Fun>");
    expect(renderContract(values)).toEqual(first);
  });
});
