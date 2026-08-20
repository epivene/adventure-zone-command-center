export function mergeOptimisticActivities<T extends { id: string }>(
  persisted: T[],
  optimistic: T[],
): T[] {
  const persistedIds = new Set(persisted.map((item) => item.id));
  return [
    ...optimistic.filter((item) => !persistedIds.has(item.id)),
    ...persisted,
  ];
}
