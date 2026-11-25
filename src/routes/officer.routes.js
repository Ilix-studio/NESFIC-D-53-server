import { Router } from 'express';

import * as officers from '../controllers/officer.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createOfficerBody } from '../validators/index.js';

// Mounted at /officers. Admins and supervisors only (checked in the service).
const router = Router();
router.post('/', requireAuth, validate(createOfficerBody), officers.create);

export default router;
