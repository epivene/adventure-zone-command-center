export type PackageAvailabilityTemplate = {
  code: string;
  name: string;
  normalCapacity: number;
  temporaryUnavailableQuantity: number;
};

export type PackageAvailabilityReservation = {
  confidence: "explicit" | "ambiguous";
  packages: Array<{ packageKey: string; quantity: number }>;
  evidence?: string[];
};

export type PackageAvailabilityResult = {
  status: "resolved" | "unresolved";
  packages: Array<{
    packageKey: string;
    normalCapacity: number;
    bookedQuantity: number;
    temporaryUnavailableQuantity: number;
    availableQuantity: number;
  }>;
  restrictedOptions: Array<{
    packageKey: string;
    name: string;
    approvalRequired: true;
    reason: string;
  }>;
  blockers: string[];
};

const restrictedOptions: PackageAvailabilityResult["restrictedOptions"] = [
  {
    packageKey: "pirates_rebellion_restricted_fourth_unit",
    name: "Pirate's Rebellion restricted fourth unit",
    approvalRequired: true,
    reason: "Massive pool; requires extremely flat ground.",
  },
  {
    packageKey: "mini_zone",
    name: "Mini Zone",
    approvalRequired: true,
    reason:
      "Last-resort / Dave approval only; estimated $5,000–$6,000 with final price set by Dave.",
  },
];

function canonicalPackageKey(key: string): string {
  return key === "warriors_playground" ? "weekend_warriors" : key;
}

export function calculatePackageAvailability(input: {
  packages: readonly PackageAvailabilityTemplate[];
  reservations: readonly PackageAvailabilityReservation[];
}): PackageAvailabilityResult {
  const bookedByPackage = new Map<string, number>();
  const blockers: string[] = [];

  for (const reservation of input.reservations) {
    if (reservation.confidence === "ambiguous") {
      blockers.push(...(reservation.evidence?.length
        ? reservation.evidence
        : ["ambiguous Calendar package usage"]));
      continue;
    }

    for (const packageReservation of reservation.packages) {
      const key = canonicalPackageKey(packageReservation.packageKey);
      if (!Number.isInteger(packageReservation.quantity) || packageReservation.quantity < 0) {
        blockers.push(`invalid Calendar quantity for ${packageReservation.packageKey}`);
        continue;
      }
      bookedByPackage.set(key, (bookedByPackage.get(key) ?? 0) + packageReservation.quantity);
    }
  }

  return {
    status: blockers.length ? "unresolved" : "resolved",
    packages: input.packages.map((template) => {
      const packageKey = canonicalPackageKey(template.code);
      const bookedQuantity = bookedByPackage.get(packageKey) ?? 0;
      const normalCapacity = Math.max(0, template.normalCapacity);
      const temporaryUnavailableQuantity = Math.max(
        0,
        template.temporaryUnavailableQuantity,
      );
      return {
        packageKey: template.code,
        normalCapacity,
        bookedQuantity,
        temporaryUnavailableQuantity,
        availableQuantity: Math.max(
          0,
          normalCapacity - bookedQuantity - temporaryUnavailableQuantity,
        ),
      };
    }),
    restrictedOptions,
    blockers: [...new Set(blockers)],
  };
}
