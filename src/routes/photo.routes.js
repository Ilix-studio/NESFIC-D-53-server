import { Router } from 'express';

import * as photos from '../controllers/photo.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { caseNotLockedUnlessPhoneEvidence } from '../middleware/caseNotLocked.js';
import { requireFile, uploadPhoto } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { photoBody } from '../validators/index.js';

// Mounted at /cases/:id/photos
const router = Router({ mergeParams: true });
router.use(requireAuth);
router.post('/', caseNotLockedUnlessPhoneEvidence, uploadPhoto, requireFile('photo'), validate(photoBody), photos.upload);
router.get('/', photos.list);
router.get('/:photoId/file', photos.file);

export default router;
