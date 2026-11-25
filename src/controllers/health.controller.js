import { env } from '../config/env.js';
import { dbState } from '../config/db.js';
import { getSchema } from '../schema/index.js';
import { getAsr } from '../services/asr/index.js';
import { installedLangs } from '../services/asr/indicconformer.asr.js';

export function health(req, res) {
  const db = dbState();
  const schema = getSchema();
  res.status(db === 'connected' ? 200 : 503).json({
    status: db === 'connected' ? 'ok' : 'degraded',
    db,
    // The engine actually in use (no key or no model file runs the mock), and the languages
    // with a speech model on this server.
    engines: { asr: getAsr().name, asrLangs: getAsr().name === 'indicconformer' ? installedLangs() : [], mapper: env.MAPPER_ENGINE },
    schema: { id: schema.schemaId, version: schema.version, placeholder: Boolean(schema.placeholder) },
    time: new Date().toISOString(),
  });
}
