import type { ActRateLimit, ActTransport } from "@/features/act-sync/act-types";

export type ActReadRequest = {
  path: `/api/${string}`;
  query?: Readonly<Record<string, string>>;
};

export interface ActReadTransport {
  getJson(input: ActReadRequest): Promise<unknown>;
  readonly rateLimit: ActRateLimit;
}

export class GetOnlyActTransport implements ActReadTransport {
  constructor(private readonly delegate: ActTransport) {}

  get rateLimit() {
    return this.delegate.rateLimit;
  }

  getJson(input: ActReadRequest) {
    return this.delegate.requestJson({
      path: input.path,
      method: "GET",
      ...(input.query ? { query: input.query } : {}),
    });
  }
}
