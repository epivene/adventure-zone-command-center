export type HandoffOpportunityBand = "strong" | "possible" | "weak" | "infeasible";

export type HandoffScoreInput = {
  directMiles: number;
  directMinutes: number;
  fromDetourMiles: number;
  fromDetourMinutes: number;
  toDetourMiles: number;
  toDetourMinutes: number;
  availableBufferMinutes: number;
  minimumTransferMinutes: number;
  equipmentReady: boolean;
};

export type HandoffScore = {
  band: HandoffOpportunityBand;
  score: number;
  reasons: string[];
};

export function scoreHandoff(input: HandoffScoreInput): HandoffScore {
  if (!input.equipmentReady) {
    return {
      band: "infeasible",
      score: 0,
      reasons: ["Equipment is not available at the proposed transfer time."],
    };
  }

  const usableBuffer = input.availableBufferMinutes - input.minimumTransferMinutes;
  if (usableBuffer < 90) {
    return {
      band: "infeasible",
      score: 0,
      reasons: ["The transfer leaves less than 90 minutes of travel/setup buffer."],
    };
  }

  const combinedDetourMiles = input.fromDetourMiles + input.toDetourMiles;
  const combinedDetourMinutes = input.fromDetourMinutes + input.toDetourMinutes;
  let score = 100;
  score -= Math.min(35, input.directMiles * 0.2);
  score -= Math.min(25, input.directMinutes * 0.18);
  score -= Math.min(25, combinedDetourMinutes * 0.22);
  score -= Math.min(15, combinedDetourMiles * 0.18);
  if (usableBuffer >= 240) score += 10;
  else if (usableBuffer >= 150) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let band: HandoffOpportunityBand;
  if (
    input.directMiles <= 50 &&
    input.directMinutes <= 60 &&
    usableBuffer >= 120 &&
    score >= 65
  ) {
    band = "strong";
  } else if (
    (input.directMiles <= 100 || input.directMinutes <= 120) &&
    usableBuffer >= 90 &&
    score >= 40
  ) {
    band = "possible";
  } else {
    band = "weak";
  }

  const reasons: string[] = [];
  if (input.directMiles <= 50) reasons.push("The two route anchors are within about 50 miles.");
  else if (input.directMiles <= 100) reasons.push("The two route anchors are within about 100 miles.");
  if (input.directMinutes <= 60) reasons.push("Driving time between the route anchors is about an hour or less.");
  else if (input.directMinutes <= 120) reasons.push("Driving time between the route anchors is about two hours or less.");
  if (usableBuffer >= 240) reasons.push("Both schedules leave a large handoff buffer.");
  else if (usableBuffer >= 120) reasons.push("The schedules leave a workable handoff buffer.");
  if (combinedDetourMinutes > 90) reasons.push("The proposed meetup adds a meaningful detour.");
  if (!reasons.length) reasons.push("The transfer is feasible, but timing and travel make it a weaker option.");

  return { band, score, reasons };
}
