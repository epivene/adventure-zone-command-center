import { apiFetch } from "@/lib/auth-token";
import { officeFetch } from "@/lib/office-auth-context";
import { bossFetch } from "@/lib/boss-auth-context";
import type {
  ContractWorkspaceRecord,
  CreateInvoiceInput,
  InvoiceFilters,
  InvoiceRecord,
  InvoiceWorkspaceClient,
} from "@/features/invoices/invoice-types";

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

async function json<T>(fetcher: Fetcher, path: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function query(filters: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.size ? `?${params.toString()}` : "";
}

export function createInvoiceWorkspaceClient(fetcher: Fetcher, prefix = ""): InvoiceWorkspaceClient {
  const base = `${prefix}/invoices`;
  return {
    list(filters: InvoiceFilters = {}) {
      return json(fetcher, `${base}${query(filters)}`);
    },
    summary(filters = {}) {
      return json(fetcher, `${base}/summary${query(filters)}`);
    },
    detail(invoiceId) {
      return json(fetcher, `${base}/${invoiceId}`);
    },
    create(input: CreateInvoiceInput) {
      return json(fetcher, base, { method: "POST", body: JSON.stringify(input) });
    },
    update(invoiceId, patch) {
      return json(fetcher, `${base}/${invoiceId}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    recordPayment(invoiceId, input) {
      return json(fetcher, `${base}/${invoiceId}/payments`, { method: "POST", body: JSON.stringify(input) });
    },
    voidPayment(invoiceId, paymentId) {
      return json(fetcher, `${base}/${invoiceId}/payments/${paymentId}/void`, { method: "POST", body: "{}" });
    },
  };
}

export function createContractWorkspaceClient(fetcher: Fetcher, prefix = "") {
  return {
    list(filters: { organizationId?: string; bookingId?: string; status?: string } = {}) {
      return json<{ contracts: ContractWorkspaceRecord[] }>(fetcher, `${prefix}/contracts/workspace${query(filters)}`);
    },
  };
}

export const invoicesApi = createInvoiceWorkspaceClient(apiFetch);
export const officeInvoicesApi = createInvoiceWorkspaceClient(officeFetch, "/office");
export const bossInvoicesApi = createInvoiceWorkspaceClient(bossFetch, "/boss");
export const contractsWorkspaceApi = createContractWorkspaceClient(apiFetch);
export const officeContractsWorkspaceApi = createContractWorkspaceClient(officeFetch, "/office");
export const bossContractsWorkspaceApi = createContractWorkspaceClient(bossFetch, "/boss");
