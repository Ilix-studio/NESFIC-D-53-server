import { Router } from 'express';

import * as review from '../controllers/review.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { caseNotLocked } from '../middleware/caseNotLocked.js';
import { validate } from '../middleware/validate.js';
import { editFieldBody } from '../validators/index.js';

// Mounted at /cases/:id. Middleware is per route (not router.use) because other
// /cases/:id requests pass through this router on their way to case.routes.js.
const router = Router({ mergeParams: true });
const guard = [requireAuth, caseNotLocked];
router.patch('/fields/:fieldId', guard, validate(editFieldBody), review.edit);
router.post('/fields/:fieldId/confirm', guard, review.confirm);
router.post('/sign', guard, review.sign);

export default router;
