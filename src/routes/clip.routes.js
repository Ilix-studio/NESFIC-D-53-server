import { Router } from 'express';

import * as clips from '../controllers/clip.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { caseNotLockedUnlessPhoneEvidence } from '../middleware/caseNotLocked.js';
import { requireFile, uploadAudio } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { clipBody, phoneClipBody } from '../validators/index.js';

// Mounted at /cases/:id/clips
const router = Router({ mergeParams: true });
router.use(requireAuth);
// ?firstPass=phone: the phone already processed the clip offline; the server re-checks it later.
const clipBodyFor = (req) => (req.query.firstPass === 'phone' ? phoneClipBody : clipBody);
router.post('/', caseNotLockedUnlessPhoneEvidence, uploadAudio, requireFile('audio'), validate(clipBodyFor), clips.upload);
router.get('/', clips.list);
router.get('/:clipId/audio', clips.audio);

export default router;
