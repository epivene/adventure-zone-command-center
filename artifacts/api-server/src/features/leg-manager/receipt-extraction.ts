import { z } from "zod";
import { createAiClient, NOT_CONFIGURED_ERROR } from "@/features/ai-suggestions/ai-client";

export type ReceiptSuggestions = {
  merchant: string | null;
  totalCents: number | null;
  taxCents: number | null;
  occurredAt: string | null;
};

const suggestionSchema = z.object({
  merchant: z.string().trim().max(200).nullable().optional(),
  totalCents: z.number().int().nonnegative().nullable().optional(),
  taxCents: z.number().int().nonnegative().nullable().optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const emptySuggestions = (): ReceiptSuggestions => ({ merchant: null, totalCents: null, taxCents: null, occurredAt: null });

export function parseReceiptSuggestions(raw: string): ReceiptSuggestions {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = suggestionSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) return emptySuggestions();
    return {
      merchant: parsed.data.merchant?.trim() || null,
      totalCents: parsed.data.totalCents ?? null,
      taxCents: parsed.data.taxCents ?? null,
      occurredAt: parsed.data.occurredAt ?? null,
    };
  } catch {
    return emptySuggestions();
  }
}

export async function extractReceiptFields(input: { bytes: Uint8Array; mimeType: string }): Promise<{ suggestions: ReceiptSuggestions | null; unavailable: boolean }> {
  try {
    const client = await createAiClient();
    if (!client.completeImage) return { suggestions: null, unavailable: true };
    const prompt = `Read this receipt and return JSON only with this exact shape: {"merchant":null,"totalCents":null,"taxCents":null,"occurredAt":null}. Use integer cents for monetary fields and YYYY-MM-DD for occurredAt. Do not guess fields that are not visible.`;
    const raw = await client.completeImage({
      prompt,
      mimeType: input.mimeType,
      base64: Buffer.from(input.bytes).toString("base64"),
    });
    return { suggestions: parseReceiptSuggestions(raw), unavailable: false };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === NOT_CONFIGURED_ERROR) {
      return { suggestions: null, unavailable: true };
    }
    return { suggestions: null, unavailable: true };
  }
}
