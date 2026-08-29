import { useEffect, useState } from "react";
import {
  loadDevelopmentSampleLogins,
  type DevelopmentSampleLogins,
} from "@/lib/development-sample-logins";

type LoginKind = "office" | "manager";

export function DevelopmentLoginHint({
  kind,
  onUse,
}: {
  kind: LoginKind;
  onUse?: (sample: DevelopmentSampleLogins) => void;
}) {
  const [sample, setSample] = useState<DevelopmentSampleLogins | null>(null);

  useEffect(() => {
    let active = true;
    void loadDevelopmentSampleLogins().then((value) => {
      if (active) setSample(value);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!sample) return null;

  const isOffice = kind === "office";
  return (
    <aside className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950 dark:border-orange-900/70 dark:bg-orange-950/30 dark:text-orange-100">
      <p className="font-bold">Development sample login</p>
      {isOffice ? (
        <dl className="mt-2 grid gap-1">
          <div className="flex justify-between gap-3">
            <dt>Username</dt>
            <dd className="font-mono font-semibold">{sample.office.loginName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Password</dt>
            <dd className="font-mono font-semibold">{sample.office.password}</dd>
          </div>
        </dl>
      ) : (
        <dl className="mt-2 grid gap-1">
          <div className="flex justify-between gap-3">
            <dt>Travel leg</dt>
            <dd className="text-right font-semibold">{sample.manager.legName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Password</dt>
            <dd className="font-mono font-semibold">{sample.manager.password}</dd>
          </div>
        </dl>
      )}
      {onUse ? (
        <button
          className="button-secondary mt-3 w-full"
          type="button"
          onClick={() => onUse(sample)}
        >
          {isOffice ? "Sign in with demo account" : "Sign in with demo"}
        </button>
      ) : null}
      <p className="mt-2 text-xs text-orange-800 dark:text-orange-200">
        This panel is visible only in the development app.
      </p>
    </aside>
  );
}