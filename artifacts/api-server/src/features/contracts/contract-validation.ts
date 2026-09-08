import type {
  ContractReadiness,
  ContractValidationIssue,
  ContractValues,
} from "./contract-types";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function issue(path: string, code: string, message: string): ContractValidationIssue {
  return { path, code, message };
}

function requireText(errors: ContractValidationIssue[], path: string, value: string, label: string) {
  if (!value.trim()) errors.push(issue(path, "REQUIRED", `${label} is required.`));
}

function requireDate(errors: ContractValidationIssue[], path: string, value: string, label: string) {
  if (!validDate(value)) errors.push(issue(path, "DATE_INVALID", `${label} must be a valid date.`));
}

function requireMoney(errors: ContractValidationIssue[], path: string, value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) errors.push(issue(path, "MONEY_INVALID", `${label} must be a nonnegative cent amount.`));
}

function requirePercent(errors: ContractValidationIssue[], path: string, value: number) {
  if (!Number.isInteger(value) || value <= 0 || value > 10_000) {
    errors.push(issue(path, "PERCENTAGE_INVALID", "Percentage must be greater than 0% and no more than 100%."));
  }
}

export function validateContractValues(values: ContractValues): ContractReadiness {
  const errors: ContractValidationIssue[] = [];
  const warnings: ContractValidationIssue[] = [];

  requireText(errors, "organizationName", values.organizationName, "Organization name");
  requireText(errors, "eventName", values.eventName, "Event name");
  requireText(errors, "venueName", values.venueName, "Venue name");
  requireText(errors, "venueAddress.address1", values.venueAddress.address1, "Venue address");
  requireText(errors, "venueAddress.city", values.venueAddress.city, "Venue city");
  requireText(errors, "venueAddress.region", values.venueAddress.region, "Venue state");
  requireDate(errors, "eventStartDate", values.eventStartDate, "Event start");
  requireDate(errors, "eventEndDate", values.eventEndDate, "Event end");
  if (validDate(values.eventStartDate) && validDate(values.eventEndDate) && values.eventEndDate < values.eventStartDate) {
    errors.push(issue("eventEndDate", "DATE_ORDER_INVALID", "Event end cannot be before event start."));
  }

  for (const [key, signer] of [["eventSigner", values.eventSigner], ["internalSigner", values.internalSigner]] as const) {
    requireText(errors, `${key}.name`, signer.name, "Signer name");
    requireText(errors, `${key}.role`, signer.role, "Signer role");
    if (!emailPattern.test(signer.email.trim())) errors.push(issue(`${key}.email`, "EMAIL_INVALID", "Signer email must be valid."));
  }
  if (values.eventSigner.order !== 1) errors.push(issue("eventSigner.order", "SIGNER_ORDER_INVALID", "The event representative must sign first."));
  if (values.internalSigner.order !== 2) errors.push(issue("internalSigner.order", "SIGNER_ORDER_INVALID", "Dave must sign second."));
  if (values.eventSigner.email.trim().toLowerCase() === values.internalSigner.email.trim().toLowerCase()) {
    errors.push(issue("internalSigner.email", "SIGNER_DUPLICATE", "The two signers must use different email addresses."));
  }

  if (!values.packages.length && !values.operationalTerms.attractionDescription.trim()) {
    errors.push(issue("operationalTerms.attractionDescription", "ATTRACTION_REQUIRED", "Describe the package or attractions."));
  }
  if (values.physicalAttractionTotal !== null && (!Number.isInteger(values.physicalAttractionTotal) || values.physicalAttractionTotal < 0)) {
    errors.push(issue("physicalAttractionTotal", "ATTRACTION_TOTAL_INVALID", "Attraction total must be a nonnegative whole number."));
  }

  const terms = values.commercialTerms;
  if (terms.arrangement !== values.arrangement) {
    errors.push(issue("commercialTerms.arrangement", "ARRANGEMENT_MISMATCH", "Commercial terms must match the selected arrangement."));
  } else if (terms.arrangement === "guaranteed_fee") {
    requireMoney(errors, "commercialTerms.totalFeeCents", terms.totalFeeCents, "Total fee");
    requireMoney(errors, "commercialTerms.depositCents", terms.depositCents, "Deposit");
    requireMoney(errors, "commercialTerms.balanceCents", terms.balanceCents, "Balance");
    requireDate(errors, "commercialTerms.depositDueDate", terms.depositDueDate, "Deposit due date");
    requireText(errors, "commercialTerms.paymentTiming", terms.paymentTiming, "Payment timing");
    if (terms.depositCents + terms.balanceCents !== terms.totalFeeCents) {
      errors.push(issue("commercialTerms.balanceCents", "PAYMENT_TOTAL_MISMATCH", "Deposit plus balance must equal the total fee."));
    }
  } else if (terms.arrangement === "pay_for_play") {
    requirePercent(errors, "commercialTerms.eventShareBasisPoints", terms.eventShareBasisPoints);
    requireMoney(errors, "commercialTerms.upfrontChargeCents", terms.upfrontChargeCents, "Upfront charge");
    requireText(errors, "commercialTerms.settlementTiming", terms.settlementTiming, "Settlement timing");
    requireText(errors, "commercialTerms.ticketAuthority", terms.ticketAuthority, "Ticket-price authority");
    requireText(errors, "commercialTerms.collectionArrangement", terms.collectionArrangement, "Ticket collection arrangement");
  } else {
    requireMoney(errors, "commercialTerms.guaranteeCents", terms.guaranteeCents, "Guarantee");
    requireMoney(errors, "commercialTerms.depositCents", terms.depositCents, "Deposit");
    requireMoney(errors, "commercialTerms.balanceCents", terms.balanceCents, "Balance");
    requireDate(errors, "commercialTerms.depositDueDate", terms.depositDueDate, "Deposit due date");
    requirePercent(errors, "commercialTerms.eventShareBasisPoints", terms.eventShareBasisPoints);
    requireText(errors, "commercialTerms.paymentTiming", terms.paymentTiming, "Payment timing");
    requireText(errors, "commercialTerms.percentageBase", terms.percentageBase, "Percentage base");
    requireText(errors, "commercialTerms.ticketAuthority", terms.ticketAuthority, "Ticket-price authority");
    requireText(errors, "commercialTerms.collectionArrangement", terms.collectionArrangement, "Ticket collection arrangement");
    if (terms.depositCents + terms.balanceCents !== terms.guaranteeCents) {
      errors.push(issue("commercialTerms.balanceCents", "PAYMENT_TOTAL_MISMATCH", "Deposit plus balance must equal the guarantee."));
    }
  }

  const operations = values.operationalTerms;
  requireDate(errors, "operationalTerms.operatingStartDate", operations.operatingStartDate, "Operating start");
  requireDate(errors, "operationalTerms.operatingEndDate", operations.operatingEndDate, "Operating end");
  requireDate(errors, "operationalTerms.arrivalDate", operations.arrivalDate, "Arrival date");
  requireDate(errors, "operationalTerms.departureDate", operations.departureDate, "Departure date");
  if (validDate(operations.operatingStartDate) && validDate(operations.operatingEndDate) && operations.operatingEndDate < operations.operatingStartDate) {
    errors.push(issue("operationalTerms.operatingEndDate", "DATE_ORDER_INVALID", "Operating end cannot be before operating start."));
  }
  if (validDate(operations.arrivalDate) && validDate(operations.departureDate) && operations.departureDate < operations.arrivalDate) {
    errors.push(issue("operationalTerms.departureDate", "DATE_ORDER_INVALID", "Departure cannot be before arrival."));
  }
  const travelDatesNeedOverride = validDate(operations.arrivalDate) && validDate(operations.departureDate)
    && (operations.arrivalDate > values.eventStartDate || operations.departureDate < values.eventEndDate);
  if (travelDatesNeedOverride) requireText(errors, "operationalTerms.dateOverrideReason", operations.dateOverrideReason, "Travel-date override reason");
  if (!Number.isInteger(operations.workDayCount) || operations.workDayCount <= 0) {
    errors.push(issue("operationalTerms.workDayCount", "WORK_DAY_COUNT_INVALID", "Work-day count must be a positive whole number."));
  }
  const requiredOperationalText: Array<[keyof typeof operations, string]> = [
    ["dailyHours", "Daily hours"], ["attractionDescription", "Attraction description"],
    ["spaceRequirement", "Space requirement"], ["exclusivity", "Exclusivity"],
    ["powerRequirement", "Power requirement"], ["waterRequirement", "Water requirement"],
    ["forkliftRequirement", "Forklift requirement"], ["lodgingRequirement", "Lodging requirement"],
    ["restroomAccess", "Restroom access"], ["licensingResponsibilities", "Licensing responsibilities"],
    ["setupTeardownClause", "Setup and teardown terms"],
  ];
  for (const [key, label] of requiredOperationalText) requireText(errors, `operationalTerms.${key}`, String(operations[key]), label);
  if (!operations.confirmed) errors.push(issue("operationalTerms.confirmed", "OPERATIONAL_CONFIRMATION_REQUIRED", "Confirm the operational terms before generating."));

  const coiMissing = (Object.entries(values.coi) as Array<[keyof typeof values.coi, string]>)
    .filter(([, value]) => !value.trim())
    .map(([key]) => key);
  if (coiMissing.length) warnings.push(issue("coi", "COI_DETAILS_INCOMPLETE", "The contract can be generated, but a COI draft will need these details."));

  return { ready: errors.length === 0, errors, warnings, coiMissing };
}
