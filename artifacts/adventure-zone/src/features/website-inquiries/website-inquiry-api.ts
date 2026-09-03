export interface WebsiteInquiryApi {
  get<T>(path: string): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function createWebsiteInquiryApi(input: WebsiteInquiryApi): WebsiteInquiryApi {
  return input;
}
