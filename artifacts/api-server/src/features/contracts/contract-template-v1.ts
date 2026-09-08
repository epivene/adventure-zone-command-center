export type ContractTemplateDefinition = {
  stableKey: string;
  version: number;
  state: "draft" | "reviewed" | "active" | "retired";
  sourceProvenance: Array<{ messageId: string; filename: string; arrangement: string }>;
  adventureZoneClauses: string[];
  sponsorClauses: string[];
  forceMajeureClause: string;
};

export const contractTemplateV1: ContractTemplateDefinition = {
  stableKey: "adventure-zone-standard",
  version: 1,
  state: "reviewed",
  sourceProvenance: [
    {
      messageId: "1a048f5b4dab9d4f",
      filename: "Meeteetse Annual Labor Day Celebration 2026 Contract.docx",
      arrangement: "pay_for_play",
    },
    {
      messageId: "19c35c5a26d576ad",
      filename: "Stone Age Stampede Dinosaur CO 2026.docx",
      arrangement: "guaranteed_fee",
    },
  ],
  adventureZoneClauses: [
    "All federal licenses as needed to operate amusements.",
    "Liability insurance for the contracted attractions, with a Certificate of Insurance for the event holder and approved venue/property owner when required.",
    "Employees for the confirmed work week, not including travel days.",
    "One setup and one teardown per event. If the event organizer asks that inflatables be moved after setup, the event organizer will pay an additional $2,500 crew fee to move the equipment.",
    "Three-foot safety stakes to secure equipment. If those stakes cannot be used, the sponsoring body must provide an alternative method meeting The Adventure Zone specifications, at no charge to The Adventure Zone.",
    "Electronic waivers for attendees, with an adult signature required for use of the inflatables.",
  ],
  sponsorClauses: [
    "The confirmed operating space and final layout.",
    "The confirmed exclusive-use terms.",
    "The confirmed arrival and departure access.",
    "The confirmed electrical service or generator plan.",
    "The confirmed water access.",
    "Forklift support when available for teardown loading.",
    "The confirmed camping or lodging arrangement.",
    "Restroom access from arrival through departure.",
    "The agreed local and state licensing, permit, inspection, and regulation responsibilities.",
  ],
  forceMajeureClause: "Neither The Adventure Zone nor the sponsoring event shall be held responsible for an Act of God or another condition beyond reasonable control that prevents safe or lawful performance or affects the outcome of business.",
};
