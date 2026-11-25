import { Router } from 'express';

import * as followups from '../controllers/followup.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { caseNotLocked } from '../middleware/caseNotLocked.js';
import { uploadAudio } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { answerBody, followupsQuery, skipBody } from '../validators/index.js';

// Mounted at /cases/:id/followups
const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/', validate(followupsQuery, 'query'), followups.list);
// JSON { code } / { value }, or multipart with an "audio" file to answer by voice
router.post('/:fid/answer', caseNotLocked, uploadAudio, validate(answerBody), followups.answer);
router.post('/:fid/skip', caseNotLocked, validate(skipBody), followups.skip);

export default router;
