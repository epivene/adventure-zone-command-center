import { useEffect, useState } from "react";
import { apiPost } from "@/lib/auth-token";

export function DuplicateCreationWarning({
  name,
  city,
  region,
}: {
  name: string;
  city: string;
  region: string;
}) {
  const [matches, setMatches] = useState<any[]>([]),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setMatches([]);
    setFailed(false);
    if (name.trim().length < 3) return;
    const timer = setTimeout(() => {
      apiPost<any[]>("/profile-duplicates/check", { name, city, region })
        .then((rows) => {
          if (active) setMatches(rows);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name, city, region]);
  if (failed)
    return (
      <p className="text-sm text-muted-foreground">
        Duplicate check unavailable. You can still save this profile.
      </p>
    );
  if (!matches.length) return null;
  return (
    <aside
      className="rounded-xl border border-primary bg-primary/10 p-4"
      aria-label="Possible duplicates"
    >
      <p className="font-bold">This looks like it might be a duplicate.</p>
      <p className="text-sm">
        Compare before saving, or continue creating this profile.
      </p>
      {matches.map((p) => (
        <details key={p.right.id} className="mt-2">
          <summary className="cursor-pointer">
            Compare with {p.right.name} ({p.confidence})
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <strong>New profile</strong>
              <p>{name}</p>
              <p>
                {city || "Not set"} · {region || "Not set"}
              </p>
            </div>
            <div>
              <a
                className="underline"
                href={`/profiles/${p.right.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {p.right.name}
              </a>
              <p>
                {p.right.city || "Not set"} · {p.right.region || "Not set"}
              </p>
            </div>
          </div>
        </details>
      ))}
    </aside>
  );
}
