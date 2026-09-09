import { describe, expect, it } from "vitest";
import { COMMUNICATION_TEMPLATE_SEEDS } from "./communication-template-seed";
import { applyEarlyBirdPromoToRenderedTemplate } from "./communication-template-promotion";

const now = new Date("2026-10-01T12:00:00Z");

describe("Early Bird Promo template coverage", () => {
  it("decorates every convention template exactly once", () => {
    const conventionTemplates = COMMUNICATION_TEMPLATE_SEEDS.filter(
      (template) => template.category === "convention",
    );
    expect(conventionTemplates.length).toBeGreaterThan(0);

    for (const template of conventionTemplates) {
      const rendered = {
        templateId: template.code,
        subject: template.subjectTemplate ?? "",
        body: template.bodyTemplate,
        missingRequiredFields: [],
      };
      const once = applyEarlyBirdPromoToRenderedTemplate(rendered, {
        category: template.category,
        code: template.code,
        now,
        alreadyPaid: false,
        bookingId: null,
        eventYear: 2027,
      });
      const twice = applyEarlyBirdPromoToRenderedTemplate(once, {
        category: template.category,
        code: template.code,
        now,
        alreadyPaid: false,
        bookingId: null,
        eventYear: 2027,
      });
      expect(twice.body.match(/Early Bird Promo:/g)).toHaveLength(1);
      expect(twice.body).not.toContain("12% Convention Discount");
      expect(twice.promotion?.provisionalDeadlineDate).toBe("2026-10-31");
    }
  });

  it("does not decorate excluded operational messages", () => {
    const rendered = {
      templateId: "deposit_received",
      subject: "Deposit received",
      body: "Thank you for your deposit.",
      missingRequiredFields: [],
    };
    expect(applyEarlyBirdPromoToRenderedTemplate(rendered, {
      category: "payment",
      code: "deposit_received",
      now,
      alreadyPaid: false,
      bookingId: null,
      eventYear: 2027,
    })).toEqual({ ...rendered, promotion: null });
  });
});
