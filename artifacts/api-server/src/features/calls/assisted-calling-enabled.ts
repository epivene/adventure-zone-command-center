export function isAssistedCallingEnabled(value = process.env.ASSISTED_CALLING_ENABLED): boolean {
  return value === "true";
}
