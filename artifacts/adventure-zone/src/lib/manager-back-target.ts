export function managerBackTarget(pathname: string): string | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/manager") return null;
  if (/^\/manager\/crew\/[^/]+$/.test(path)) return "/manager/crew";
  if (path === "/manager/incidents/new") return "/manager/incidents";
  return "/manager";
}
