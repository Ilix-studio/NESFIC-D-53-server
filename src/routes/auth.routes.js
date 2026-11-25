import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env.js';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginBody } from '../validators/index.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts, try again in 15 minutes' } },
});

const router = Router();
router.post('/login', loginLimiter, validate(loginBody), auth.login);
router.get('/me', requireAuth, auth.me);

export default router;
