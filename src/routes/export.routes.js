import { Router } from 'express';

import * as exporter from '../controllers/export.controller.js';
import { requireAuth } from '../middleware/auth.js';

// Mounted at /cases/:id/export
const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/edar', exporter.edar);

export default router;
