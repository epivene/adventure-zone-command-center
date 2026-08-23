import type {
  PaperNoteExtractionProvider,
  PaperNoteEntryHint,
} from "./paper-note-extraction-provider";
import {
  mergeCriticalPaperNoteRead,
  shouldVerifyCriticalPaperNoteDetails,
} from "./paper-note-reading-improvements";

export class VerifyingPaperNoteExtractionProvider implements PaperNoteExtractionProvider {
  constructor(private readonly base: PaperNoteExtractionProvider) {}

  segmentPage(input: Parameters<PaperNoteExtractionProvider["segmentPage"]>[0]) {
    return this.base.segmentPage(input);
  }

  async extractEntry(input: {
    bytes: Uint8Array;
    mimeType: string;
    pageContext: Parameters<PaperNoteExtractionProvider["extractEntry"]>[0]["pageContext"];
    entryHint?: PaperNoteEntryHint;
    rotationDegrees?: 0 | 90 | 180 | 270;
  }) {
    const first = await this.base.extractEntry(input);
    if (!shouldVerifyCriticalPaperNoteDetails(first)) return first;

    const verificationHint = input.entryHint
      ? {
          ...input.entryHint,
          roughText: `${input.entryHint.roughText}\nCRITICAL VERIFICATION: independently reread the event/profile name, every visible contact name, and every phone digit. Pay special attention to 4 vs 9, 1 vs 7, 3 vs 8, and 5 vs 6. Do not copy the first reading merely because it is plausible.`,
        }
      : input.entryHint;

    const second = await this.base.extractEntry({ ...input, entryHint: verificationHint });
    return mergeCriticalPaperNoteRead(first, second);
  }
}
