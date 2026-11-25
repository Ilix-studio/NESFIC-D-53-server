import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import routes from './routes/index.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  // The phone app sends no Origin header; only the listed browser origins (Expo web) get CORS.
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)) }));
  // 'tiny' logs method, URL, status and time only: never bodies, transcripts or personal data.
  if (env.NODE_ENV !== 'test') app.use(morgan('tiny'));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (req, res) => res.json({ name: 'VoiceDAR API', api: '/api/v1', health: '/api/v1/health' }));
  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
