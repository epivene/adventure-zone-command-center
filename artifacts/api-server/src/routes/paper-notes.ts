import { Router, type IRouter } from "express";

import { db } from "@/db/client";
import { PaperNoteIntakeRepository } from "@/features/paper-notes/paper-note-intake-repository";
import { PaperNoteIntakeService } from "@/features/paper-notes/paper-note-intake-service";
import {
  PaperNoteMatchingService,
  PostgresPaperNoteMatchRepository,
} from "@/features/paper-notes/paper-note-matching-service";
import { createPaperNoteObjectStorage } from "@/features/paper-notes/paper-note-object-storage";
import { PaperNoteRecoveryRepository } from "@/features/paper-notes/paper-note-recovery-repository";
import { PaperNoteReviewRepository } from "@/features/paper-notes/paper-note-review-repository";
import { PaperNoteReviewService } from "@/features/paper-notes/paper-note-review-service";
import {
  DrizzlePaperNoteSourceResolver,
  PaperNoteSourceService,
} from "@/features/paper-notes/paper-note-source-service";
import { createPaperNoteExtractionRouter } from "./paper-note-extraction";
import { createPaperNoteIntakeRouter } from "./paper-note-intake";
import { createPaperNoteMatchingRouter } from "./paper-note-matching";
import { createPaperNoteReviewRouter } from "./paper-note-review";
import { createPaperNoteSourceRouter } from "./paper-note-source";

const router: IRouter = Router();
const objectStorage = createPaperNoteObjectStorage();
const service = new PaperNoteIntakeService(
  new PaperNoteIntakeRepository(db),
  objectStorage,
);
const recoveryRepository = new PaperNoteRecoveryRepository(db);
const reviewService = new PaperNoteReviewService(new PaperNoteReviewRepository(db));
const matchingService = new PaperNoteMatchingService(
  new PostgresPaperNoteMatchRepository(db),
);
const sourceService = new PaperNoteSourceService(
  new DrizzlePaperNoteSourceResolver(db),
  objectStorage,
);

router.use(createPaperNoteIntakeRouter(service));
router.use(createPaperNoteExtractionRouter(recoveryRepository));
router.use(createPaperNoteReviewRouter(reviewService));
router.use(createPaperNoteMatchingRouter({
  getEntry: reviewService.getEntry.bind(reviewService),
  match: matchingService.match.bind(matchingService),
}));
router.use(createPaperNoteSourceRouter(sourceService));

export default router;
