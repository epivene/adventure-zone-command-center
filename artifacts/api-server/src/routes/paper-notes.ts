import { Router, type IRouter } from "express";

import { db } from "@/db/client";
import { PaperNoteIntakeRepository } from "@/features/paper-notes/paper-note-intake-repository";
import { PaperNoteIntakeService } from "@/features/paper-notes/paper-note-intake-service";
import { createPaperNoteObjectStorage } from "@/features/paper-notes/paper-note-object-storage";
import { createPaperNoteIntakeRouter } from "./paper-note-intake";

const router: IRouter = Router();
const service = new PaperNoteIntakeService(
  new PaperNoteIntakeRepository(db),
  createPaperNoteObjectStorage(),
);

router.use(createPaperNoteIntakeRouter(service));

export default router;
