type FollowUpCountInput = {
  followUpTotal?: number;
  actionableTotal?: number;
  loadedLaterCount: number;
};

export function getLaterFollowUpCount({
  followUpTotal,
  actionableTotal,
  loadedLaterCount,
}: FollowUpCountInput): number {
  if (typeof followUpTotal !== "number" || typeof actionableTotal !== "number") {
    return loadedLaterCount;
  }

  return Math.max(loadedLaterCount, followUpTotal - actionableTotal, 0);
}
