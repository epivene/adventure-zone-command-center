import type { ContractValues } from "./contract-types";
import { contractTemplateV1 } from "./contract-template-v1";

export type RenderedContractSection = { heading: string; paragraphs: string[]; bullets: string[] };
export type RenderedSignatureBlock = { name: string; role: string; email: string; order: 1 | 2; hasDateLine: true };
export type RenderedContract = {
  title: string;
  sections: RenderedContractSection[];
  signatureBlocks: RenderedSignatureBlock[];
  text: string;
  html: string;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function percentage(basisPoints: number) {
  return `${Number((basisPoints / 100).toFixed(2))}%`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year!, month! - 1, day)));
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function commercialClauses(values: ContractValues): string[] {
  const terms = values.commercialTerms;
  if (terms.arrangement === "guaranteed_fee") {
    const discount = terms.discountWording.trim() ? `${terms.discountWording.trim()} ` : "";
    return [
      `A ${discount}${money(terms.totalFeeCents)} guaranteed event fee for operating the contracted attractions.`,
      `${money(terms.depositCents)} deposit due ${displayDate(terms.depositDueDate)} with the signed, returned contract.`,
      `${money(terms.balanceCents)} balance ${terms.paymentTiming}.`,
    ];
  }
  if (terms.arrangement === "pay_for_play") {
    return [
      `Operation on a pay-for-play basis with ${money(terms.upfrontChargeCents)} charged upfront to the sponsoring event.`,
      `${terms.ticketAuthority}; ${terms.collectionArrangement}.`,
      `Payment to the sponsoring event of ${percentage(terms.eventShareBasisPoints)} of ticket-box sales ${terms.settlementTiming}.`,
    ];
  }
  return [
    `A ${money(terms.guaranteeCents)} guaranteed event fee for operating the contracted attractions.`,
    `${money(terms.depositCents)} deposit due ${displayDate(terms.depositDueDate)} with the signed, returned contract.`,
    `${money(terms.balanceCents)} balance ${terms.paymentTiming}.`,
    `${terms.ticketAuthority}; ${terms.collectionArrangement}.`,
    `Payment to the sponsoring event of ${percentage(terms.eventShareBasisPoints)} of ${terms.percentageBase}.`,
  ];
}

function toText(title: string, sections: RenderedContractSection[], signatures: RenderedSignatureBlock[]) {
  return [
    title,
    ...sections.flatMap((section) => [section.heading, ...section.paragraphs, ...section.bullets.map((bullet) => `• ${bullet}`)]),
    "Signatures — sequential order",
    ...signatures.flatMap((signature) => [
      `${signature.order}. ${signature.name} — ${signature.role} — ${signature.email}`,
      "Signature: ________________________________  Date: ____________________",
    ]),
  ].join("\n");
}

export function renderContract(values: ContractValues): RenderedContract {
  const operations = values.operationalTerms;
  const title = `Contract between The Adventure Zone Inc. & ${values.organizationName}`;
  const sections: RenderedContractSection[] = [
    {
      heading: values.eventName,
      paragraphs: [
        `${values.venueName}, ${values.venueAddress.city}, ${values.venueAddress.region}`,
        `${displayDate(values.eventStartDate)} through ${displayDate(values.eventEndDate)}`,
      ],
      bullets: [],
    },
    {
      heading: "The Adventure Zone agrees to provide:",
      paragraphs: [],
      bullets: [
        contractTemplateV1.adventureZoneClauses[0]!,
        `${operations.attractionDescription} The Adventure Zone reserves the right to add, subtract, or change attractions as necessary for safety, mechanical, route, weather, site, or financial reasons without penalty.`,
        contractTemplateV1.adventureZoneClauses[1]!,
        `Employees for ${operations.dailyHours}, for ${operations.workDayCount} consecutive work days, not including travel days.`,
        contractTemplateV1.adventureZoneClauses[3]!,
        contractTemplateV1.adventureZoneClauses[4]!,
        contractTemplateV1.adventureZoneClauses[5]!,
      ],
    },
    {
      heading: `${values.organizationName} agrees to provide:`,
      paragraphs: [],
      bullets: [
        ...commercialClauses(values),
        operations.spaceRequirement,
        operations.exclusivity,
        `Arrival access beginning ${displayDate(operations.arrivalDate)} and departure access through ${displayDate(operations.departureDate)}. Arrival or departure may be delayed by previous/next-event logistics; travel dates do not change the contracted event dates.`,
        operations.powerRequirement,
        operations.waterRequirement,
        operations.forkliftRequirement,
        operations.lodgingRequirement,
        operations.restroomAccess,
        operations.licensingResponsibilities,
        operations.setupTeardownClause,
        ...(operations.additionalTerms.trim() ? [operations.additionalTerms.trim()] : []),
      ],
    },
    { heading: "Conditions beyond either party's control", paragraphs: [contractTemplateV1.forceMajeureClause], bullets: [] },
  ];
  const signatureBlocks: RenderedSignatureBlock[] = [values.eventSigner, values.internalSigner]
    .toSorted((left, right) => left.order - right.order)
    .map((signer) => ({ name: signer.name, role: signer.role, email: signer.email, order: signer.order, hasDateLine: true }));
  const text = toText(title, sections, signatureBlocks);
  const html = `<article>${text.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</article>`;
  return { title, sections, signatureBlocks, text, html };
}
