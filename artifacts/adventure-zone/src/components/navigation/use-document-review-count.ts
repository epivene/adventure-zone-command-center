import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/auth-token";
const queryKey = ["navigation", "document-review-count"];
export function useDocumentReviewCount() {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiGet<{ count: number }>("/business-documents/review-count"),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const changed = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      if (Number.isFinite(count)) client.setQueryData(queryKey, { count });
    };
    window.addEventListener("business-document-review-count-changed", changed);
    return () => window.removeEventListener("business-document-review-count-changed", changed);
  }, [client]);
  return data?.count ?? 0;
}
