import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { useLocation, useSearch } from "wouter";
import { bossGet, bossPatch } from "@/lib/boss-auth-context";
import { OfficeProfileEditor } from "@/components/office/office-profile-editor";
import { ConventionHistory } from "@/components/profiles/convention-history";
import { SimpleFullProfile, type OpenSection } from "@/components/profiles/simple-full-profile";
import { ProfilePageFrame } from "@/components/profiles/profile-page-frame";
import { bossProfilePresentation, type BossProfile } from "@/components/profiles/boss-profile-presentation";

export default function BossProfilePage({ profileId }: { profileId: string }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const requestedReturn = new URLSearchParams(search).get("returnTo") ?? "";
  const returnTo = /^\/boss\/(profiles|contacts)(\?|$)/.test(requestedReturn) && !/[\\\r\n]/.test(requestedReturn) ? requestedReturn : "/boss/profiles";
  const [profile, setProfile] = useState<BossProfile | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<OpenSection>(null);

  const load = useCallback(async () => {
    try {
      const result = await bossGet<{ profile: BossProfile }>(`/boss/profiles/${profileId}`);
      setProfile(result.profile);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load profile.");
    }
  }, [profileId]);
  useEffect(() => {
    setProfile(null);
    setEditing(false);
    setSection(null);
    void load();
  }, [load]);

  if (error) return <p className="rounded-xl bg-destructive/10 p-4 text-destructive" role="alert">{error}</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">Loading profile…</p>;

  return <ProfilePageFrame testId="boss-profile-page">
    <SimpleFullProfile key={profile.id} profile={bossProfilePresentation(profile)} role="boss"
      ratingSummary={profile.presentation?.ratingSummary}
      onBack={() => { if (editing) setEditing(false); else navigate(returnTo); }}
      editing={editing} onEditingChange={setEditing} onSectionChange={setSection}
      editor={<OfficeProfileEditor profile={profile as ComponentProps<typeof OfficeProfileEditor>["profile"]}
        onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }}
        saveProfile={(id, input) => bossPatch(`/boss/profiles/${id}`, input)} />} />
    {!editing && section === "notes" ? <ConventionHistory profileId={profileId} boss /> : null}
  </ProfilePageFrame>;
}
