import { useSearch, Redirect } from "wouter";

// The legacy quick-add flow redirects to the event-profile creation page,
// preserving query params (matches the original Next.js behavior).
export default function QuickAddPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  params.set("legacy", "quick-add");
  return <Redirect to={`/event-profiles/new?${params.toString()}`} replace />;
}
