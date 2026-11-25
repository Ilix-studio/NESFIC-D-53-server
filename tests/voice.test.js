// Accounts and the officer voice check, with SPEAKER_ENGINE=mock (tests/setup-env.cjs): the mock
// voiceprint comes from the file's bytes, so the same recording matches and another does not.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { upsertOfficer } from '../src/services/auth.service.js';

const VOICE = Buffer.alloc(30 * 1024, 7); // the mock counts 1 KB as 1 second
let mongo;
let app;
let admin;
let supervisor;

const login = async (badgeNo, password) => {
  const res = await request(app).post('/api/v1/auth/login').send({ badgeNo, password }).expect(200);
  return { auth: { Authorization: `Bearer ${res.body.token}` }, officer: res.body.officer };
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  app = createApp();
  await upsertOfficer({ badgeNo: 'A-1', password: 'admin-pass', name: 'Admin', policeStation: 'HQ', district: 'Kamrup (Metro)', role: 'admin' });
  await upsertOfficer({ badgeNo: 'S-1', password: 'super-pass', name: 'Supervisor', policeStation: 'Dispur PS', district: 'Kamrup (Metro)', role: 'supervisor' });
  admin = (await login('A-1', 'admin-pass')).auth;
  supervisor = (await login('S-1', 'super-pass')).auth;
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const newIo = { badgeNo: 'IO-2001', password: 'first-pass', name: 'New IO', policeStation: 'Dispur PS' };

test('accounts: admins and supervisors create them, IOs cannot, badge numbers are unique', async () => {
  const created = await request(app).post('/api/v1/officers').set(supervisor).send(newIo).expect(201);
  expect(created.body.officer).toMatchObject({ badgeNo: 'IO-2001', role: 'io', district: 'Kamrup (Metro)' });
  expect(created.body.officer.passwordHash).toBeUndefined();
  expect(created.body.officer.voice).toBeUndefined();

  await request(app).post('/api/v1/officers').set(supervisor).send(newIo).expect(409);
  await request(app).post('/api/v1/officers').set(supervisor).send({ ...newIo, badgeNo: 'S-2', role: 'supervisor' }).expect(403);
  await request(app).post('/api/v1/officers').set(supervisor).send({ ...newIo, badgeNo: 'IO-2002', district: 'Nagaon' }).expect(403);
  await request(app).post('/api/v1/officers').set(admin).send({ ...newIo, badgeNo: 'IO-2003', district: 'Nagaon' }).expect(201);
  await request(app).post('/api/v1/officers').set(admin).send({ ...newIo, badgeNo: 'IO-2004', password: 'short' }).expect(400);
  const io = await login('IO-2001', 'first-pass');
  await request(app).post('/api/v1/officers').set(io.auth).send({ ...newIo, badgeNo: 'IO-2005' }).expect(403);
});

test('enrolment: read a passage, keep only the voiceprint, then clips are checked', async () => {
  const io = await login('IO-2001', 'first-pass');
  expect(io.officer.voice).toBeUndefined();
  const passages = (await request(app).get('/api/v1/voice/passages').set(io.auth).expect(200)).body;
  expect(passages.passages.map((p) => p.lang)).toEqual(['as', 'bn', 'brx']);
  const enrol = (audio, passageId = 'as-1', lang = 'as') =>
    request(app)
      .post('/api/v1/voice/enrol')
      .set(io.auth)
      .field('lang', lang)
      .field('passageId', passageId)
      .attach('audio', audio, { filename: 'passage.m4a', contentType: 'audio/m4a' });

  await enrol(VOICE, 'bn-1', 'as').expect(400); // passage in another language
  expect((await enrol(Buffer.alloc(10 * 1024, 7)).expect(400)).body.error.message).toMatch(/too short/);
  const enrolled = (await enrol(VOICE).expect(200)).body.officer;
  expect(enrolled.voice).toMatchObject({ lang: 'as', passageId: 'as-1', model: 'mock', seconds: 30 });
  expect(enrolled.voice.embedding).toHaveLength(256);
  const me = (await request(app).get('/api/v1/auth/me').set(io.auth).expect(200)).body.officer;
  expect(me.voice.enrolledAt).toBeDefined();

  await request(app).post('/api/v1/cases').set(io.auth).send({ clientId: 'case-voice-001', startedAt: '2026-11-25T10:00:00Z' }).expect(201);
  const upload = (audio, section) =>
    request(app)
      .post('/api/v1/cases/case-voice-001/clips')
      .set(io.auth)
      .field('section', section)
      .attach('audio', audio, { filename: 'clip.m4a', contentType: 'audio/m4a' })
      .expect(201);
  const same = (await upload(VOICE, 'crash')).body.clip;
  expect(same.speaker).toMatchObject({ match: true, score: 1, engine: 'mock' });
  const other = (await upload(Buffer.alloc(8 * 1024, 3), 'road')).body.clip;
  expect(other.speaker.match).toBe(false);
  expect(other.processingStatus).toBe('done'); // a mismatch never blocks the clip

  const events = await AuditEvent.find({ type: 'speaker_mismatch' }).lean();
  expect(events).toHaveLength(1);
  expect(events[0].meta).toMatchObject({ section: 'road', threshold: 0.5 });
});
