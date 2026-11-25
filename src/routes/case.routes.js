import { Router } from 'express';

import * as cases from '../controllers/case.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createCaseBody, listCasesQuery } from '../validators/index.js';

const router = Router();
router.use(requireAuth);
router.post('/', validate(createCaseBody), cases.create);
router.get('/', validate(listCasesQuery, 'query'), cases.list);
router.get('/:id', cases.get);
router.get('/:id/audit', cases.audit);

export default router;
