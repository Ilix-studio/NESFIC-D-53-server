import { Router } from 'express';

import * as models from '../controllers/models.controller.js';

// Public: the models are openly licensed (CC-BY-4.0) and hold no case data.
const router = Router();
router.get('/', models.list);
router.get('/:modelId/file', models.file);

export default router;
