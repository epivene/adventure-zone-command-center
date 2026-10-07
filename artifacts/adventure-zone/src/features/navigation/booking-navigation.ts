export function bookingNavigation(mobile = false) {
  return [
    { href: "/today", label: "Today", icon: "home" },
    { href: "/profiles", label: "Profiles", icon: "profiles" },
    { href: "/emails", label: "Emails", icon: "emails" },
    ...(!mobile ? [{ href: "/business-documents", label: "Documents", icon: "documents" as const }] : []),
    { href: "/schedule", label: mobile ? "Schedule" : "Schedule & Routes", icon: "schedule" },
  ] as const;
}
