export const GOOGLE_PROFILE_LABEL_ROOT = "Z - AdventureZone/Profiles";
export const GOOGLE_CURRENT_PROFILE_LABEL_ROOT = "Profiles";
export const GOOGLE_PROFILE_LABEL_ROOTS = [
  GOOGLE_CURRENT_PROFILE_LABEL_ROOT,
  GOOGLE_PROFILE_LABEL_ROOT,
] as const;
export const GOOGLE_PROFILE_LABEL_HIERARCHY = [
  "Z - AdventureZone",
  GOOGLE_PROFILE_LABEL_ROOT,
] as const;

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

export function canonicalProfileLabelName(
  profileName: string,
  root: typeof GOOGLE_PROFILE_LABEL_ROOTS[number] = GOOGLE_PROFILE_LABEL_ROOT,
): string {
  if (/[\/\r\n\0]/.test(profileName)) {
    throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_NAME_INVALID");
  }
  const name = profileName.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 180) {
    throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_NAME_INVALID");
  }
  return `${root}/${name}`;
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
  return profileLabelIdentity(value) !== null;
}

// Compare the leaf only inside the two explicitly supported profile roots.
// Gmail IDs remain the durable identity after a mapping has been saved.
export function profileLabelIdentity(value: string): string | null {
  const normalized = normalizedProfileLabelPath(value);
  for (const root of GOOGLE_PROFILE_LABEL_ROOTS) {
    const prefix = `${normalizedProfileLabelPath(root)}/`;
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      return normalized.slice(prefix.length);
    }
  }
  return null;
}
