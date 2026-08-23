import { Redirect, useSearch } from "wouter";

export default function ContactsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  params.set("view", "contacts");
  const suffix = params.toString();
  return <Redirect to={`/profiles${suffix ? `?${suffix}` : ""}`} />;
}
