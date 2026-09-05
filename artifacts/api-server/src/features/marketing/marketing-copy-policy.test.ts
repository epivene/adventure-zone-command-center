import { describe, expect, it, vi } from "vitest";
import { MarketingError, MarketingService, canTransitionMarketingCampaign, renderMarketingCopy } from "./marketing-service";

describe("marketing campaign policy", () => {
  it("rejects unresolved copy instead of silently sending placeholders", () => {
    expect(() => renderMarketingCopy("Hello {{contactName}}", {})).toThrow(MarketingError);
    expect(renderMarketingCopy("Hello {{contactName}}", { contactName: "Avery" })).toBe("Hello Avery");
  });

  it("enforces approval and retry boundaries", () => {
    expect(canTransitionMarketingCampaign("draft", "send_now")).toBe(false);
    expect(canTransitionMarketingCampaign("needs_review", "approve")).toBe(true);
    expect(canTransitionMarketingCampaign("approved", "send_now")).toBe(true);
    expect(canTransitionMarketingCampaign("failed", "retry")).toBe(true);
    expect(canTransitionMarketingCampaign("sent", "retry")).toBe(false);
  });

  it("sends a test only to its explicit address and never requires campaign recipients", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "test-message" });
    const database = {
      // Test sends write an event, but deliberately provide no select API: any
      // recipient lookup/iteration would fail this test.
      transaction: async (callback: any) => callback({
        insert: () => ({ values: async () => undefined }),
      }),
    };
    const service = new MarketingService(database as any, () => ({ send }));
    vi.spyOn(service, "getCampaign").mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001", subjectTemplate: "Preview {{senderName}}",
      bodyTemplate: "Only {{contactName}}", extraValues: {}, senderName: "Owner",
      senderEmail: null, senderPhone: null,
    } as any);
    await service.sendTest("00000000-0000-4000-8000-000000000001", "ONLY@example.test", { contactName: "Preview" });
    expect(send).toHaveBeenCalledWith({ to: "only@example.test", subject: "Preview Owner", body: "Only Preview" });
  });

  it("surfaces provider failures safely during test delivery", async () => {
    const service = new MarketingService({} as any, () => ({ send: async () => { throw new Error("smtp password=sensitive"); } }));
    vi.spyOn(service, "getCampaign").mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001", subjectTemplate: "Hi", bodyTemplate: "Body",
      extraValues: {}, senderName: "Owner", senderEmail: null, senderPhone: null,
    } as any);
    await expect(service.sendTest("00000000-0000-4000-8000-000000000001", "test@example.test"))
      .rejects.toMatchObject({ code: "DELIVERY_FAILED", message: "The email provider could not deliver this message." });
  });

  it("maps a campaign audience foreign-key conflict to a safe conflict response", async () => {
    const database = {
      delete: () => ({
        where: () => ({
          returning: async () => { throw Object.assign(new Error("internal constraint"), { code: "23503" }); },
        }),
      }),
    };
    const service = new MarketingService(database as any);
    await expect(service.deleteAudience("00000000-0000-4000-8000-000000000001"))
      .rejects.toMatchObject({
        code: "AUDIENCE_IN_USE",
        status: 409,
        message: "This audience is used by a campaign and cannot be deleted.",
      });
  });
});