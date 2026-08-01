/**
 * Route-matching service for Act! calendar scan.
 * Takes parsed activity/note/history items and a list of known route names,
 * and annotates each item with the routes it mentions.
 */

import type { ParsedActActivityItem } from "@/features/act-migration/act-activity-parser";

export type AnnotatedActItem = ParsedActActivityItem & {
  matchedRoutes: string[];
};

export type RouteMatchGroup = {
  routeName: string;
  items: AnnotatedActItem[];
};

export type RouteMatchResult = {
  matched: RouteMatchGroup[];
  unmatched: AnnotatedActItem[];
};

/**
 * Annotate each item with routes found in its text blob (case-insensitive
 * substring search), then group matched items by route name.
 */
export function matchItemsToRoutes(
  items: ParsedActActivityItem[],
  routeNames: string[],
): RouteMatchResult {
  // Pre-compute lowercase route names for efficient comparison
  const lowerRoutes = routeNames.map((name) => ({
    original: name,
    lower: name.toLowerCase(),
  }));

  const groupsByRoute = new Map<string, AnnotatedActItem[]>();
  const unmatched: AnnotatedActItem[] = [];

  for (const item of items) {
    const textLower = item.textBlob.toLowerCase();
    const matchedRoutes = lowerRoutes
      .filter(({ lower }) => lower.length > 0 && textLower.includes(lower))
      .map(({ original }) => original);

    const annotated: AnnotatedActItem = { ...item, matchedRoutes };

    if (matchedRoutes.length === 0) {
      unmatched.push(annotated);
    } else {
      for (const routeName of matchedRoutes) {
        const existing = groupsByRoute.get(routeName);
        if (existing) {
          existing.push(annotated);
        } else {
          groupsByRoute.set(routeName, [annotated]);
        }
      }
    }
  }

  // Sort groups by route name for stable output
  const matched: RouteMatchGroup[] = Array.from(groupsByRoute.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([routeName, items]) => ({ routeName, items }));

  return { matched, unmatched };
}
