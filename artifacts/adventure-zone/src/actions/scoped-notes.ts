import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

export async function listLocationNotes(organizationId: string, locationId: string) {
  return (await apiGet<{ notes: ScopedNoteView[] }>(`/organizations/${organizationId}/locations/${locationId}/notes`)).notes;
}

export async function createLocationNote(organizationId: string, locationId: string, body: string) {
  return (await apiPost<{ note: ScopedNoteView }>(`/organizations/${organizationId}/locations/${locationId}/notes`, { body })).note;
}

export async function updateLocationNote(organizationId: string, locationId: string, noteId: string, body: string) {
  return (await apiPatch<{ note: ScopedNoteView }>(`/organizations/${organizationId}/locations/${locationId}/notes/${noteId}`, { body })).note;
}

export async function deleteLocationNote(organizationId: string, locationId: string, noteId: string) {
  await apiDelete(`/organizations/${organizationId}/locations/${locationId}/notes/${noteId}`);
}

export async function listFamilyNotes(familyId: string) {
  return (await apiGet<{ notes: ScopedNoteView[] }>(`/event-families/${familyId}/notes`)).notes;
}

export async function createFamilyNote(familyId: string, body: string) {
  return (await apiPost<{ note: ScopedNoteView }>(`/event-families/${familyId}/notes`, { body })).note;
}

export async function updateFamilyNote(familyId: string, noteId: string, body: string) {
  return (await apiPatch<{ note: ScopedNoteView }>(`/event-families/${familyId}/notes/${noteId}`, { body })).note;
}

export async function deleteFamilyNote(familyId: string, noteId: string) {
  await apiDelete(`/event-families/${familyId}/notes/${noteId}`);
}
