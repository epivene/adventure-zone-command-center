type InvoiceSeasonRecord = {
  bookingStartsAt?: string | null;
  invoiceNumber: string;
  documentName: string;
  balanceDueDate: string | null;
  depositDueDate: string | null;
  issueDate: string;
  effectiveStatus: string;
  remainingCents: number;
};

type ContractSeasonRecord = {
  id: string;
  bookingStartsAt?: string | null;
  bookingName: string;
};

type ContractDocumentSeasonRecord = {
  id: string;
  effectiveDate: string | null;
  issueDate: string | null;
  displayName: string;
  originalFilename: string;
  links: Array<{ targetLabel?: string | null }>;
};

const unknownYear = "unknown";

export function invoiceContractYear(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const match = value?.match(/(?:^|[^0-9])((?:19|20)\d{2})(?!\d)/);
    if (match?.[1]) return match[1];
  }
  return unknownYear;
}

function invoiceYear(invoice: InvoiceSeasonRecord) {
  return invoiceContractYear(
    invoice.bookingStartsAt,
    invoice.invoiceNumber,
    invoice.documentName,
    invoice.balanceDueDate,
    invoice.depositDueDate,
    invoice.issueDate,
  );
}

function contractYear(contract: ContractSeasonRecord) {
  return invoiceContractYear(contract.bookingStartsAt, contract.bookingName);
}

function documentYear(document: ContractDocumentSeasonRecord) {
  return invoiceContractYear(
    document.effectiveDate,
    document.issueDate,
    document.displayName,
    document.originalFilename,
    ...document.links.map((link) => link.targetLabel),
  );
}

export function latestInvoiceContractSeason(input: {
  invoices: InvoiceSeasonRecord[];
  contracts: ContractSeasonRecord[];
  contractDocuments: ContractDocumentSeasonRecord[];
}) {
  const years = [
    ...input.invoices.map(invoiceYear),
    ...input.contracts.map(contractYear),
    ...input.contractDocuments.map(documentYear),
  ];
  const year = years
    .filter((value) => value !== unknownYear)
    .sort((left, right) => Number(right) - Number(left))[0]
    ?? (years.includes(unknownYear) ? unknownYear : "");
  const inSeason = (candidate: string) => !year || candidate === year;
  const invoices = input.invoices.filter((invoice) => inSeason(invoiceYear(invoice)));
  const workflowContractIds = new Set(
    input.contracts.filter((contract) => inSeason(contractYear(contract))).map((contract) => contract.id),
  );
  const uploadedContractIds = new Set(
    input.contractDocuments.filter((document) => inSeason(documentYear(document))).map((document) => document.id),
  );

  return {
    year,
    totalInvoices: invoices.length,
    overdueCount: invoices.filter((invoice) => invoice.effectiveStatus === "overdue").length,
    outstandingCents: invoices.reduce((total, invoice) => total + invoice.remainingCents, 0),
    contracts: workflowContractIds.size + uploadedContractIds.size,
  };
}
