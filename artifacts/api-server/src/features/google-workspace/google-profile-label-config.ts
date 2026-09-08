export const GOOGLE_PROFILE_LABEL_ROOT = "Z - AdventureZone/Profiles";

export type GoogleProfileLabelConfig = {
  enabled: boolean;
  root: typeof GOOGLE_PROFILE_LABEL_ROOT;
};

export function readGoogleProfileLabelConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleProfileLabelConfig {
  return {
    enabled:
      environment.GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED === "true",
    root: GOOGLE_PROFILE_LABEL_ROOT,
  };
}

export function canonicalProfileLabelName(profileName: string): string {
  const name = profileName.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 180 || /[\/\r\n\0]/.test(name)) {
    throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_NAME_INVALID");
  }
  return `${GOOGLE_PROFILE_LABEL_ROOT}/${name}`;
}

export function normalizedProfileLabelPath(value: string): string {
  return value
    .normalize("NFKC")
    .split("/")
    .map((part) =>
      part.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"),
    )
    .join("/");
}

export function isProfileLabelPath(value: string): boolean {
  const normalizedRoot = normalizedProfileLabelPath(GOOGLE_PROFILE_LABEL_ROOT);
  const normalized = normalizedProfileLabelPath(value);
  return normalized.startsWith(`${normalizedRoot}/`) &&
    normalized.length > normalizedRoot.length + 1;
}
