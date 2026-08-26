const RECIPIENT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipientBlockEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return RECIPIENT_EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export type RecipientCommunicationBlockTarget = {
  targetType: "recipient_email";
  normalizedEmail: string;
};

export function parseRecipientCommunicationBlockTarget(
  value: unknown,
): RecipientCommunicationBlockTarget | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.targetType !== "recipient_email") return null;
  if (body.organizationId || body.contactId || body.rowId) return null;
  const normalizedEmail = normalizeRecipientBlockEmail(body.normalizedEmail);
  return normalizedEmail ? { targetType: "recipient_email", normalizedEmail } : null;
}
