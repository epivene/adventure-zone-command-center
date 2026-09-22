export type InvoiceStatus = "draft" | "sent" | "deposit_due" | "deposit_paid" | "paid" | "cancelled";
export type InvoiceEffectiveStatus = InvoiceStatus | "overdue";

export type InvoicePayment = {
  id: string;
  amountCents: number;
  receivedDate: string;
  method: string | null;
  notes: string | null;
  voidedAt: string | null;
};

export type InvoiceRecord = {
  id: string;
  organizationId: string;
  organizationName: string;
  bookingId: string | null;
  bookingName: string | null;
  bookingStartsAt?: string | null;
  documentId: string;
  documentName: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  storedStatus: InvoiceStatus;
  effectiveStatus: InvoiceEffectiveStatus;
  currency: "USD";
  totalCents: number;
  depositCents: number;
  paidCents: number;
  remainingCents: number;
  creditCents: number;
  issueDate: string;
  depositDueDate: string | null;
  balanceDueDate: string | null;
  nextDueDate: string | null;
  notes: string | null;
  payments: InvoicePayment[];
};

export type InvoiceFilters = {
  organizationId?: string;
  bookingId?: string;
  status?: InvoiceStatus;
};

export type InvoiceAttentionSummary = {
  totalInvoices: number;
  overdueCount: number;
  overdueCents: number;
  depositDueCount: number;
  outstandingCents: number;
};

export type CreateInvoiceInput = {
  organizationId: string;
  bookingId?: string | null;
  documentId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalCents: number;
  depositCents: number;
  issueDate: string;
  depositDueDate?: string | null;
  balanceDueDate?: string | null;
  notes?: string | null;
};

export type InvoiceWorkspaceClient = {
  list(filters?: InvoiceFilters): Promise<{ invoices: InvoiceRecord[] }>;
  summary(filters?: Omit<InvoiceFilters, "status">): Promise<{ summary: InvoiceAttentionSummary }>;
  detail(invoiceId: string): Promise<{ invoice: InvoiceRecord }>;
  create(input: CreateInvoiceInput): Promise<{ invoice: InvoiceRecord }>;
  update(invoiceId: string, patch: Partial<Omit<CreateInvoiceInput, "organizationId" | "documentId">>): Promise<{ invoice: InvoiceRecord }>;
  recordPayment(invoiceId: string, input: { amountCents: number; receivedDate: string; method?: string | null; notes?: string | null }): Promise<{ invoice: InvoiceRecord }>;
  voidPayment(invoiceId: string, paymentId: string): Promise<{ invoice: InvoiceRecord }>;
};

export type ContractWorkspaceRecord = {
  id: string;
  organizationId: string;
  organizationName: string;
  bookingId: string;
  bookingName: string;
  bookingStartsAt?: string | null;
  status: string;
  versionNumber: number;
  updatedAt: string;
};
