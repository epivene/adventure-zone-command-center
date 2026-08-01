import { redirect } from "next/navigation";

function creationHref(query: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, item);
    }
  }
  params.set("legacy", "booking");
  return `/event-profiles/new?${params.toString()}`;
}

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(creationHref(await searchParams));
}
