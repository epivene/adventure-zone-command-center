import { Router, type IRouter } from "express";

import { db } from "@/db/client";
import { PaperNoteIntakeRepository } from "@/features/paper-notes/paper-note-intake-repository";
import { PaperNoteIntakeService } from "@/features/paper-notes/paper-note-intake-service";
import { createPaperNoteObjectStorage } from "@/features/paper-notes/paper-note-object-storage";
import { PaperNoteRecoveryRepository } from "@/features/paper-notes/paper-note-recovery-repository";
import { createPaperNoteExtractionRouter } from "./paper-note-extraction";
import { createPaperNoteIntakeRouter } from "./paper-note-intake";

const router: IRouter = Router();
const service = new PaperNoteIntakeService(
  new PaperNoteIntakeRepository(db),
  createPaperNoteObjectStorage(),
);
const recoveryRepository = new PaperNoteRecoveryRepository(db);

router.use(createPaperNoteIntakeRouter(service));
router.use(createPaperNoteExtractionRouter(recoveryRepository));

export default router;
