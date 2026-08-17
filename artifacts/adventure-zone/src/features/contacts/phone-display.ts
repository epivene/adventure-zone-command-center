export function formatPhoneDisplay(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;

  if (/\b(?:ext\.?|x)\s*\d+/i.test(raw)) return raw;

  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const isInternational = raw.startsWith("+") && !raw.startsWith("+1");

  if (local.length !== 10 || isInternational) return raw;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function phoneHref(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;

  if (/\b(?:ext\.?|x)\s*\d+/i.test(raw)) return `tel:${raw.replace(/\s+/g, "")}`;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${raw}`;
}
