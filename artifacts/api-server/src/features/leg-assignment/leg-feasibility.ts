import { strongestTravelWarning, type LegAssignmentWarning } from "./leg-assignment-domain";
import type { AssignmentTarget, RouteStop } from "./leg-assignment-repository";

export const MIN_OPERATIONAL_BUFFER_MINUTES = 3 * 24 * 60;
export const SETUP_TEARDOWN_ALLOWANCE_MINUTES = 24 * 60;

export type DrivePoint = { latitude: number; longitude: number };
export type DriveTimeEstimator = {
  estimateMinutes(from: DrivePoint, to: DrivePoint): Promise<number | null>;
};

export type FeasibilityResult = {
  eligible: boolean;
  previousDriveMinutes: number | null;
  nextDriveMinutes: number | null;
  availableBeforeMinutes: number | null;
  availableAfterMinutes: number | null;
  warning: LegAssignmentWarning | null;
  reason: string;
};

function coordinates(value: { latitude: number | null; longitude: number | null }): DrivePoint | null {
  return value.latitude === null || value.longitude === null
    ? null
    : { latitude: value.latitude, longitude: value.longitude };
}

function differenceMinutes(later: Date, earlier: Date) {
  return Math.floor((later.getTime() - earlier.getTime()) / 60_000);
}

async function driveMinutes(
  estimator: DriveTimeEstimator,
  from: RouteStop | AssignmentTarget,
  to: RouteStop | AssignmentTarget,
): Promise<number | null> {
  const fromPoint = coordinates(from);
  const toPoint = coordinates(to);
  if (!fromPoint || !toPoint) return null;
  return estimator.estimateMinutes(fromPoint, toPoint);
}

function requiredGap(drive: number | null) {
  if (drive === null) return MIN_OPERATIONAL_BUFFER_MINUTES;
  return Math.max(MIN_OPERATIONAL_BUFFER_MINUTES, drive + SETUP_TEARDOWN_ALLOWANCE_MINUTES);
}

export async function evaluateLegFeasibility(input: {
  target: AssignmentTarget;
  previousStop: RouteStop | null;
  nextStop: RouteStop | null;
  estimator: DriveTimeEstimator;
}): Promise<FeasibilityResult> {
  const availableBeforeMinutes = input.previousStop
    ? differenceMinutes(input.target.startsAt, input.previousStop.endsAt)
    : null;
  const availableAfterMinutes = input.nextStop
    ? differenceMinutes(input.nextStop.startsAt, input.target.endsAt)
    : null;

  const previousDriveMinutes = input.previousStop
    ? await driveMinutes(input.estimator, input.previousStop, input.target)
    : null;
  const nextDriveMinutes = input.nextStop
    ? await driveMinutes(input.estimator, input.target, input.nextStop)
    : null;

  if (input.previousStop && previousDriveMinutes === null) {
    return {
      eligible: false,
      previousDriveMinutes,
      nextDriveMinutes,
      availableBeforeMinutes,
      availableAfterMinutes,
      warning: strongestTravelWarning(previousDriveMinutes, nextDriveMinutes),
      reason: "Previous-stop travel time is unavailable; manual review is required.",
    };
  }
  if (input.nextStop && nextDriveMinutes === null) {
    return {
      eligible: false,
      previousDriveMinutes,
      nextDriveMinutes,
      availableBeforeMinutes,
      availableAfterMinutes,
      warning: strongestTravelWarning(previousDriveMinutes, nextDriveMinutes),
      reason: "Next-stop travel time is unavailable; manual review is required.",
    };
  }

  if (
    availableBeforeMinutes !== null &&
    availableBeforeMinutes < requiredGap(previousDriveMinutes)
  ) {
    return {
      eligible: false,
      previousDriveMinutes,
      nextDriveMinutes,
      availableBeforeMinutes,
      availableAfterMinutes,
      warning: strongestTravelWarning(previousDriveMinutes, nextDriveMinutes),
      reason: "Not enough time between the previous confirmed stop and this event for travel and setup.",
    };
  }

  if (
    availableAfterMinutes !== null &&
    availableAfterMinutes < requiredGap(nextDriveMinutes)
  ) {
    return {
      eligible: false,
      previousDriveMinutes,
      nextDriveMinutes,
      availableBeforeMinutes,
      availableAfterMinutes,
      warning: strongestTravelWarning(previousDriveMinutes, nextDriveMinutes),
      reason: "Not enough time after this event to reach the next confirmed stop and reset.",
    };
  }

  return {
    eligible: true,
    previousDriveMinutes,
    nextDriveMinutes,
    availableBeforeMinutes,
    availableAfterMinutes,
    warning: strongestTravelWarning(previousDriveMinutes, nextDriveMinutes),
    reason: "The confirmed route leaves enough travel and setup time.",
  };
}
