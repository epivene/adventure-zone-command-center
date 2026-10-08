import { FestivalProfileWorkspace } from './_shared/profile-current/festival-profile-workspace';
import { demoProfile } from './_shared/profile-current/adapter';
export function CurrentProfileWorkflow() { return <main className="min-h-dvh bg-background p-4 text-foreground sm:p-6"><FestivalProfileWorkspace profile={demoProfile} originLabel="Profiles" onBack={() => {}} onFollowUp={() => {}} legacyTools={<p>Existing organizer and CRM tools — preview data only.</p>} /></main>; }
