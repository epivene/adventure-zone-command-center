export const placeTypeValues = [
  "fair",
  "city_government",
  "festival_event",
  "venue",
  "school",
  "tribe",
  "association",
  "company",
  "other",
] as const;

export type PlaceType = (typeof placeTypeValues)[number];
