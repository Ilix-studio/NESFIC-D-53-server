import { Router } from 'express';

import * as sync from '../controllers/sync.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { pullQuery, syncBody } from '../validators/index.js';

const router = Router();
router.use(requireAuth);
router.post('/cases', validate(syncBody), sync.cases);
router.get('/pull', validate(pullQuery, 'query'), sync.pull);

export default router;
