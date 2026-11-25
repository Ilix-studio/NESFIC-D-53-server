import { Router } from 'express';

import * as voice from '../controllers/voice.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFile, uploadAudio } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { voiceEnrolBody } from '../validators/index.js';

// Mounted at /voice
const router = Router();
router.use(requireAuth);
router.get('/passages', voice.passages);
router.post('/enrol', uploadAudio, requireFile('audio'), validate(voiceEnrolBody), voice.enrol);

export default router;
