export const MANAGER_MAP_MODE_KEY = "adventure-zone.manager-map-mode.v1";

export type ManagerMapMode = "planning" | "on-road";

export const UTAH_DEFAULT_VIEW = {
  center: [-111.9, 40.2] as [number, number],
  zoom: 6,
};

export function readManagerMapMode(storage: Pick<Storage, "getItem">): ManagerMapMode {
  return storage.getItem(MANAGER_MAP_MODE_KEY) === "on-road" ? "on-road" : "planning";
}

export function writeManagerMapMode(storage: Pick<Storage, "setItem">, mode: ManagerMapMode) {
  storage.setItem(MANAGER_MAP_MODE_KEY, mode);
}

function destinationValue(destination: [number, number] | string) {
  if (typeof destination === "string") return destination;
  const [lng, lat] = destination;
  return `${lat},${lng}`;
}

export function googleDirectionsUrl(input: {
  destination: [number, number] | string;
  waypoints?: Array<[number, number] | string>;
}) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destinationValue(input.destination));
  if (input.waypoints?.length) {
    url.searchParams.set("waypoints", input.waypoints.map(destinationValue).join("|"));
  }
  return url.toString();
}

export function managerEventDirectionsDestination(input: {
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  region?: string | null;
}): [number, number] | string | null {
  if (
    input.latitude != null &&
    input.longitude != null &&
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude)
  ) {
    return [input.longitude, input.latitude];
  }

  const place = [input.city, input.region]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", ");
  return place || null;
}
