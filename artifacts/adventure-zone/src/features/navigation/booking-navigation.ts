export function bookingNavigation(mobile = false) {
  return [
    { href: "/today", label: "Today", icon: "home" },
    { href: "/profiles", label: "Profiles", icon: "profiles" },
    { href: "/emails", label: "Emails", icon: "emails" },
    { href: "/schedule", label: mobile ? "Schedule" : "Schedule & Routes", icon: "schedule" },
  ] as const;
}
