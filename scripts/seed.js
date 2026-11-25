// Creates a demo officer and one demo case. Synthetic data only.
// Usage: npm run seed   (safe to run again; it updates the officer and keeps the case)
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import * as authService from '../src/services/auth.service.js';
import * as caseService from '../src/services/case.service.js';

const DEMO_OFFICER = {
  badgeNo: 'IO-1001',
  password: process.env.SEED_PASSWORD ?? 'demo1234',
  name: 'Demo IO (synthetic)',
  policeStation: 'Demo PS',
  district: 'Kamrup (Metro)',
  role: 'io',
};

await connectDb(env.MONGO_URI);
try {
  const officer = await authService.upsertOfficer(DEMO_OFFICER);
  const { caseDoc, created } = await caseService.createCase(officer, {
    clientId: 'demo-case-001',
    startedAt: new Date('2026-11-23T15:44:00Z'), // 23 Nov, 21:14 IST
    location: { lat: 26.14, lng: 91.73, accuracy: 12 },
  });
  console.log(`Officer ${officer.badgeNo} / ${DEMO_OFFICER.password} (${officer.policeStation}, ${officer.district})`);
  console.log(`Demo case ${caseDoc.clientId} ${created ? 'created' : 'already existed'} (id ${caseDoc._id})`);
} finally {
  await disconnectDb();
}
