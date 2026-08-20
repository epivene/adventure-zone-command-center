import { Router, type IRouter } from "express";

import { db } from "@/db/client";
import { PaperNoteArchiveService } from "@/features/paper-notes/paper-note-archive-service";
import { PaperNoteImportService } from "@/features/paper-notes/paper-note-import-service";
import { PaperNoteIntakeRepository } from "@/features/paper-notes/paper-note-intake-repository";
import { PaperNoteIntakeService } from "@/features/paper-notes/paper-note-intake-service";
import {
  PaperNoteMatchingService,
  PostgresPaperNoteMatchRepository,
} from "@/features/paper-notes/paper-note-matching-service";
import { createPaperNoteObjectStorage } from "@/features/paper-notes/paper-note-object-storage";
import { PaperNotePhoneService } from "@/features/paper-notes/paper-note-phone-service";
import {
  DrizzlePaperNotePreflightRepository,
  PaperNotePreflightService,
} from "@/features/paper-notes/paper-note-preflight-service";
import { PaperNoteRecoveryRepository } from "@/features/paper-notes/paper-note-recovery-repository";
import {
  DrizzlePaperNoteRereadRepository,
  PaperNoteRereadService,
} from "@/features/paper-notes/paper-note-reread-service";
import { PaperNoteReviewRepository } from "@/features/paper-notes/paper-note-review-repository";
import { PaperNoteReviewService } from "@/features/paper-notes/paper-note-review-service";
import {
  DrizzlePaperNoteSourceResolver,
  PaperNoteSourceService,
} from "@/features/paper-notes/paper-note-source-service";
import { createPaperNoteExtractionRouter } from "./paper-note-extraction";
import { createPaperNoteImportRouter } from "./paper-note-import";
import { createPaperNoteIntakeRouter } from "./paper-note-intake";
import { createPaperNoteMatchingRouter } from "./paper-note-matching";
import { createPaperNoteRereadRouter } from "./paper-note-reread";
import { createPaperNoteReviewRouter } from "./paper-note-review";
import { createPaperNoteSourceRouter } from "./paper-note-source";

const router: IRouter = Router();
const objectStorage = createPaperNoteObjectStorage();
const service = new PaperNoteIntakeService(
  new PaperNoteIntakeRepository(db),
  objectStorage,
);
const recoveryRepository = new PaperNoteRecoveryRepository(db);
const rereadService = new PaperNoteRereadService(
  new DrizzlePaperNoteRereadRepository(db),
  objectStorage,
);
const reviewService = new PaperNoteReviewService(new PaperNoteReviewRepository(db));
const matchingService = new PaperNoteMatchingService(
  new PostgresPaperNoteMatchRepository(db),
);
const sourceService = new PaperNoteSourceService(
  new DrizzlePaperNoteSourceResolver(db),
  objectStorage,
);
const preflightService = new PaperNotePreflightService(
  new DrizzlePaperNotePreflightRepository(db),
  objectStorage,
);
const importService = new PaperNoteImportService(
  db,
  preflightService,
  new PaperNotePhoneService(),
);
const archiveService = new PaperNoteArchiveService(db);

router.use(createPaperNoteIntakeRouter(service));
router.use(createPaperNoteExtractionRouter(recoveryRepository));
router.use(createPaperNoteRereadRouter({
  reread: rereadService.reread.bind(rereadService),
}));
router.use(createPaperNoteReviewRouter(reviewService));
router.use(createPaperNoteMatchingRouter({
  getEntry: reviewService.getEntry.bind(reviewService),
  match: matchingService.match.bind(matchingService),
}));
router.use(createPaperNoteSourceRouter(sourceService));
router.use(createPaperNoteImportRouter({
  preflight: preflightService.preflight.bind(preflightService),
  importBatch: importService.importBatch.bind(importService),
  archiveBatch: archiveService.archiveBatch.bind(archiveService),
}));

export default router;
