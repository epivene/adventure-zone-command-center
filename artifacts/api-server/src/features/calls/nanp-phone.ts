export function normalizeNanpPhone(input: string): string | null {
  const value = input.trim();
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) return null;

  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+") && !digits.startsWith("1")) return null;
  const nationalNumber = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;

  if (!/^[2-9]\d{9}$/.test(nationalNumber)) return null;
  return `+1${nationalNumber}`;
}
