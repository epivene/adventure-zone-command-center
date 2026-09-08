import type { ContractValues } from "../contract-types";
import { guaranteedFeeSnapshot } from "./guaranteed-fee.snapshot";

export const payForPlaySnapshot: ContractValues = {
  ...guaranteedFeeSnapshot,
  organizationName: "Meeteetse Annual Labor Day Celebration",
  eventName: "Meeteetse Annual Labor Day Celebration",
  venueName: "Meeteetse Visitor Center event site",
  venueAddress: { address1: "P.O. Box 238", address2: "", city: "Meeteetse", region: "WY", postalCode: "82433" },
  eventStartDate: "2026-09-05",
  eventEndDate: "2026-09-07",
  arrangement: "pay_for_play",
  commercialTerms: {
    arrangement: "pay_for_play", eventShareBasisPoints: 1_000,
    settlementTiming: "within 24 hours of the last operating day",
    ticketAuthority: "The Adventure Zone sets public ticket prices",
    collectionArrangement: "The Adventure Zone collects ticket-box sales",
    upfrontChargeCents: 0,
  },
  operationalTerms: {
    ...guaranteedFeeSnapshot.operationalTerms,
    operatingStartDate: "2026-09-05", operatingEndDate: "2026-09-07", workDayCount: 3,
    arrivalDate: "2026-09-03", departureDate: "2026-09-08",
    attractionDescription: "8–10 inflatable attractions, including water slides, an obstacle course, a large slide, a maze, and additional bounce/activity attractions.",
    spaceRequirement: "Adequate site space for 8–10 inflatables, ticket box, clearances, circulation, emergency access, and loading, with final layout approved by The Adventure Zone.",
    exclusivity: "The Adventure Zone is the exclusive commercial inflatable, amusement ride, and pay-to-play carnival game operator; existing celebration activities and non-inflatable games are excluded.",
    powerRequirement: "Four 220-volt 50-amp outlets or twenty-four separate 110-volt outlets within 150 feet, or a 50 kW generator; final plan confirmed in writing.",
    lodgingRequirement: "Permission to camp with the attractions from arrival through departure, or suitable hotel accommodations provided by the sponsoring body.",
  },
};
