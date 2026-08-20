import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const profileActions = readFileSync("src/components/profiles/profile-primary-actions.tsx", "utf8");
const contactPage = readFileSync("src/pages/ContactDetailPage.tsx", "utf8");
const eventProfileWorkspace = readFileSync("src/components/event-profiles/event-profile-workspace.tsx", "utf8");
const quickAddCaller = readFileSync("src/components/contacts/quick-add-caller.tsx", "utf8");

describe("global guided call entry points", () => {
  it("routes profile Call through the guided workspace even when assisted calling is disabled", () => {
    expect(profileActions).toContain('href={newCallHref}>Call</Link>');
    expect(profileActions).not.toContain('href={`tel:${callablePhone}`}>Call</a>');
  });

  it("routes contact and event-profile Call actions through /calls/new", () => {
    expect(contactPage).toContain('href={`/calls/new?contactId=${contactId}`}>Call</Link>');
    expect(contactPage).not.toContain('Assisted calling is not enabled.');
    expect(eventProfileWorkspace).toContain('href={callHref(profile, context, selectedContactId)}>Call</Link>');
    expect(eventProfileWorkspace).not.toContain('Assisted calling is not enabled.');
  });

  it("keeps quick-add caller flowing directly into the guided workspace", () => {
    expect(quickAddCaller).toContain('/calls/new?contactId=');
  });
});
