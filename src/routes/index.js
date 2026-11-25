import { Router } from 'express';

import { health } from '../controllers/health.controller.js';
import authRoutes from './auth.routes.js';
import caseRoutes from './case.routes.js';
import clipRoutes from './clip.routes.js';
import exportRoutes from './export.routes.js';
import followupRoutes from './followup.routes.js';
import modelRoutes from './models.routes.js';
import officerRoutes from './officer.routes.js';
import photoRoutes from './photo.routes.js';
import reviewRoutes from './review.routes.js';
import syncRoutes from './sync.routes.js';
import voiceRoutes from './voice.routes.js';

// Everything is mounted under /api/v1. Only /health, /auth/login and /models (openly licensed
// speech models for offline use) work without a JWT.
const router = Router();
router.get('/health', health);
router.use('/auth', authRoutes);
router.use('/models', modelRoutes);
router.use('/officers', officerRoutes);
router.use('/voice', voiceRoutes);
router.use('/cases/:id/clips', clipRoutes);
router.use('/cases/:id/photos', photoRoutes);
router.use('/cases/:id/followups', followupRoutes);
router.use('/cases/:id/export', exportRoutes);
router.use('/cases/:id', reviewRoutes);
router.use('/cases', caseRoutes);
router.use('/sync', syncRoutes);

export default router;
