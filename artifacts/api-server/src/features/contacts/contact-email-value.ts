import { z } from "zod";

const sendableEmailSchema = z.string().email();

export function normalizeContactEmailValue(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

export function normalizeSendableContactEmail(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeContactEmailValue(value);
  return normalized && sendableEmailSchema.safeParse(normalized).success
    ? normalized
    : null;
}
