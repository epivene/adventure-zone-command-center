import { useEffect, useState } from "react";
import { Link } from "wouter";
import { conventionRequest } from "@/pages/ConventionOutreachPage";
type Entry = {
  id: string;
  edition_id: string;
  convention: string;
  year: number;
  data: { group: string; outcome: string; notes: string; nextAction: string };
};
export function ConventionHistory({
  profileId,
  boss = false,
}: {
  profileId: string;
  boss?: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setEntries([]);
    setError("");
    conventionRequest<{ members: Entry[] }>(boss, `/profiles/${profileId}`)
      .then((r) => {
        if (active) setEntries(r.members);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [profileId, boss, reload]);
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-lg font-bold">Convention History</h2>
      {error ? (
        <p role="alert">
          {error} <button onClick={() => setReload(reload + 1)}>Retry</button>
        </p>
      ) : entries.length ? (
        entries.map((e) => (
          <div key={e.id} className="mt-3 border-t pt-3">
            <Link
              className="font-semibold text-primary"
              href={`${boss ? "/boss" : ""}/conventions?edition=${e.edition_id}`}
            >
              {e.convention} {e.year}
            </Link>
            <p>
              {e.data.group.replaceAll("_", " ")} ·{" "}
              {e.data.outcome.replaceAll("_", " ")}
            </p>
            <p className="whitespace-pre-wrap">{e.data.notes}</p>
            {e.data.nextAction && <p>Next: {e.data.nextAction}</p>}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No convention history linked yet.
        </p>
      )}
    </section>
  );
}
