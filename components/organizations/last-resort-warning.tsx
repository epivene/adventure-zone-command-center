export function LastResortWarning({
  organizationName,
  reason,
}: {
  organizationName: string;
  reason: string | null;
}) {
  return (
    <aside
      className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-950"
      role="alert"
    >
      <strong>{organizationName} is marked Last Resort.</strong>{" "}
      {reason || "Review this account before making any new commitments."}
    </aside>
  );
}
