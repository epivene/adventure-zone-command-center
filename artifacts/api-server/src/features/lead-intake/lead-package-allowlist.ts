export const APPROVED_NORMAL_PACKAGE_FAMILIES = {
  adventure_zone: ["adventure_zone"],
  pirates_rebellion: ["pirates_rebellion", "pirate_rebellion"],
  weekend_warriors: ["weekend_warriors", "warriors_playground"],
} as const;

export type ApprovedNormalPackage = keyof typeof APPROVED_NORMAL_PACKAGE_FAMILIES;
export function approvedNormalPackageForKey(key: string): ApprovedNormalPackage | null {
  for (const [family, aliases] of Object.entries(APPROVED_NORMAL_PACKAGE_FAMILIES)) {
    if ((aliases as readonly string[]).includes(key)) return family as ApprovedNormalPackage;
  }
  return null;
}
export function isApprovedNormalPackageKey(key: string) { return approvedNormalPackageForKey(key) !== null; }
