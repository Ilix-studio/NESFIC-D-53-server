import os from 'node:os';

import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { getAsr } from './services/asr/index.js';
import { resumePending } from './services/serverPassQueue.js';

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

try {
  await connectDb(env.MONGO_URI);
} catch (err) {
  console.error(`Could not connect to MongoDB (${err.name}). Is it running? Check MONGO_URI in server/.env`);
  process.exit(1);
}

const asr = getAsr().name;
const server = createApp().listen(env.PORT, () => {
  console.log(`VoiceDAR API on http://localhost:${env.PORT}/api/v1 (ASR: ${asr}, mapper: ${env.MAPPER_ENGINE})`);
  if (asr !== env.ASR_ENGINE) {
    console.log(`  ASR_ENGINE=${env.ASR_ENGINE} has no API key or model file, so the ${asr} engine is used (npm run fetch-models)`);
  }
  for (const ip of lanAddresses()) console.log(`  from a phone on the same Wi-Fi: http://${ip}:${env.PORT}/api/v1`);
});

const resumed = await resumePending();
if (resumed) console.log(`  re-checking ${resumed} clip(s) left in the queue`);

async function shutdown() {
  server.close();
  await disconnectDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
