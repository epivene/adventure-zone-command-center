import { Router, type IRouter } from "express";

import { db } from "@/db/client";
import { PaperNoteArchiveService } from "@/features/paper-notes/paper-note-archive-service";
import { EnhancedPaperNoteMatchingService } from "@/features/paper-notes/paper-note-enhanced-matching-service";
import {
  DrizzlePaperNoteHealthRepository,
  PaperNoteHealthService,
} from "@/features/paper-notes/paper-note-health-service";
import { PaperNoteImportService } from "@/features/paper-notes/paper-note-import-service";
import { PaperNoteIntakeRepository } from "@/features/paper-notes/paper-note-intake-repository";
import { PaperNoteIntakeService } from "@/features/paper-notes/paper-note-intake-service";
import {
  PaperNoteManualProfileSearchService,
  PostgresPaperNoteManualProfileSearchRepository,
} from "@/features/paper-notes/paper-note-manual-profile-search";
import { SafePostgresPaperNoteMatchRepository } from "@/features/paper-notes/paper-note-safe-matching-repository";
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
  DrizzlePaperNoteRestoreRepository,
  PaperNoteSourceRestoreService,
} from "@/features/paper-notes/paper-note-source-restore-service";
import {
  DrizzlePaperNoteSourceResolver,
  PaperNoteSourceService,
} from "@/features/paper-notes/paper-note-source-service";
import { createPaperNoteExtractionRouter } from "./paper-note-extraction";
import { createPaperNoteHealthRouter } from "./paper-note-health";
import { createPaperNoteImportRouter } from "./paper-note-import";
import { createPaperNoteIntakeRouter } from "./paper-note-intake";
import { createPaperNoteManualProfileSearchRouter } from "./paper-note-manual-profile-search";
import { createPaperNoteMatchingRouter } from "./paper-note-matching";
import { createPaperNoteRereadRouter } from "./paper-note-reread";
import { createPaperNoteReviewRouter } from "./paper-note-review";
import { createPaperNoteSourceRestoreRouter } from "./paper-note-source-restore";
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
const restoreService = new PaperNoteSourceRestoreService(
  new DrizzlePaperNoteRestoreRepository(db),
  objectStorage,
);
const healthService = new PaperNoteHealthService(
  new DrizzlePaperNoteHealthRepository(db),
);
const reviewService = new PaperNoteReviewService(new PaperNoteReviewRepository(db));
const matchingService = new EnhancedPaperNoteMatchingService(
  new SafePostgresPaperNoteMatchRepository(db),
);
const manualProfileSearchService = new PaperNoteManualProfileSearchService(
  new PostgresPaperNoteManualProfileSearchRepository(db),
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

router.use(createPaperNoteHealthRouter(healthService));
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
router.use(createPaperNoteManualProfileSearchRouter(manualProfileSearchService));
router.use(createPaperNoteSourceRestoreRouter({
  restore: restoreService.restore.bind(restoreService),
}));
router.use(createPaperNoteSourceRouter(sourceService));
router.use(createPaperNoteImportRouter({
  preflight: preflightService.preflight.bind(preflightService),
  importBatch: importService.importBatch.bind(importService),
  archiveBatch: archiveService.archiveBatch.bind(archiveService),
}));

export default router;