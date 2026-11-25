// Offline-first sync: outbox batches, conflict rule, server re-check -> proposals, pull.
import { readFileSync } from 'node:fs';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { upsertOfficer } from '../src/services/auth.service.js';
import { incomingWins } from '../src/services/caseState.js';
import { ruleMapper } from '../src/services/mapper/rule.mapper.js';
import { idle } from '../src/services/serverPassQueue.js';

const samples = JSON.parse(readFileSync(new URL('../test-data/transcripts.as.json', import.meta.url), 'utf8'));
const AUDIO = Buffer.alloc(1024, 1);
const STARTED = '2026-11-23T15:44:00.000Z';
let mongo;
let app;
let auth;
let otherAuth;
let seq = 0;

const login = async (badgeNo, password) => {
  const res = await request(app).post('/api/v1/auth/login').send({ badgeNo, password }).expect(200);
  return { Authorization: `Bearer ${res.body.token}` };
};
const opId = () => `op-${String(++seq).padStart(6, '0')}`;
const at = (minute) => `2026-11-23T16:${String(minute).padStart(2, '0')}:00.000Z`;
const op = (caseId, entity, name, payload) => ({ opId: opId(), caseId, entity, op: name, createdAt: at(0), payload });
const fieldOp = (caseId, key, value, extra = {}) =>
  op(caseId, 'field', 'set', { key, value, source: 'speech', confirmedByOfficer: false, updatedAt: at(1), ...extra });
const push = (ops, headers = auth) => request(app).post('/api/v1/sync/cases').set(headers).send({ ops });
const getCase = async (id) => (await request(app).get(`/api/v1/cases/${id}`).set(auth).expect(200)).body.case;
const valueOf = (c, key) => c.fields.find((f) => f.fieldId === key)?.value;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  app = createApp();
  await upsertOfficer({ badgeNo: 'S-1', password: 'secret-1', name: 'Sync IO', policeStation: 'Test PS', district: 'Kamrup (Metro)' });
  await upsertOfficer({ badgeNo: 'S-2', password: 'secret-2', name: 'Other IO', policeStation: 'Other PS', district: 'Nagaon' });
  auth = await login('S-1', 'secret-1');
  otherAuth = await login('S-2', 'secret-2');
}, 120_000);

afterAll(async () => {
  await idle();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('conflict rule', () => {
  const speech = (minute) => ({ source: 'speech', confirmedByOfficer: false, updatedAt: at(minute) });
  const officer = (minute) => ({ source: 'officer_edit', confirmedByOfficer: true, updatedAt: at(minute) });
  const confirmed = (minute) => ({ source: 'speech', confirmedByOfficer: true, updatedAt: at(minute) });

  test('an officer edit or confirmation beats any other value, even a newer one', () => {
    expect(incomingWins(officer(1), speech(9))).toBe(false);
    expect(incomingWins(confirmed(1), speech(9))).toBe(false);
    expect(incomingWins(speech(9), officer(1))).toBe(true);
  });

  test('between values of the same kind, the newer one wins', () => {
    expect(incomingWins(speech(1), speech(2))).toBe(true);
    expect(incomingWins(speech(2), speech(1))).toBe(false);
    expect(incomingWins(officer(1), confirmed(2))).toBe(true);
    expect(incomingWins(undefined, speech(1))).toBe(true);
  });
});

test('an outbox batch is applied once, however often it is retried', async () => {
  const caseId = 'case-ops-001';
  const ops = [
    op(caseId, 'case', 'create', { startedAt: STARTED, location: { lat: 26.14, lng: 91.73 }, lang: 'as' }),
    fieldOp(caseId, 'weather', 'rain'),
    fieldOp(caseId, 'made_up_field', 'x'),
    op(caseId, 'audit', 'append', { type: 'case_opened', meta: { gps: true }, at: at(0) }),
  ];
  const first = (await push(ops).expect(200)).body;
  expect(first.results.map((r) => r.status)).toEqual(['applied', 'applied', 'rejected', 'applied']);
  expect(first.results[2].reason).toMatch(/unknown field/);
  expect(first.cases[0]).toMatchObject({ caseId, status: 'draft' });

  // The phone did not get the response and sends the same batch again.
  const retry = (await push(ops).expect(200)).body;
  expect(retry.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'rejected', 'duplicate']);
  const audit = await AuditEvent.find({ origin: 'phone', type: 'case_opened' });
  expect(audit).toHaveLength(1);
  expect(valueOf(await getCase(caseId), 'weather')).toBe('rain');
});

test('sync never replaces an officer value with speech, and ops for unknown or foreign cases are rejected', async () => {
  const caseId = 'case-ops-002';
  await push([
    op(caseId, 'case', 'create', { startedAt: STARTED }),
    fieldOp(caseId, 'lighting', 'night_no_lights', { source: 'officer_edit', confirmedByOfficer: true, updatedAt: at(5) }),
  ]).expect(200);
  await push([fieldOp(caseId, 'lighting', 'daylight', { updatedAt: at(9) })]).expect(200);
  expect(valueOf(await getCase(caseId), 'lighting')).toBe('night_no_lights');

  const unknown = (await push([fieldOp('case-never-created', 'weather', 'rain')]).expect(200)).body;
  expect(unknown.results[0]).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/case\/create/) });
  const foreign = (await push([fieldOp(caseId, 'weather', 'fog')], otherAuth).expect(200)).body;
  expect(foreign.results[0]).toMatchObject({ status: 'rejected' });
});

test('a phone-first clip is re-checked on the server and differences come back as proposals', async () => {
  const caseId = 'case-ops-003';
  // What the phone filled offline from its weaker on-device transcripts.
  const phoneOps = [op(caseId, 'case', 'create', { startedAt: STARTED, lang: 'as' })];
  for (const section of ['crash', 'road', 'vehicles']) {
    const proposals = await ruleMapper.map({
      transcript: { text: samples.onDevice.sections[section], lang: 'as' },
      section,
      context: { startedAt: new Date(STARTED) },
    });
    for (const p of proposals) phoneOps.push(fieldOp(caseId, p.fieldId, p.value, { clipId: `${caseId}-${section}` }));
  }
  await push(phoneOps).expect(200);

  for (const section of ['crash', 'road', 'vehicles']) {
    const res = await request(app)
      .post(`/api/v1/cases/${caseId}/clips?firstPass=phone`)
      .set(auth)
      .field('section', section)
      .field('clientId', `${caseId}-${section}`)
      .field('transcriptText', samples.onDevice.sections[section])
      .field('transcriptEngine', 'demo')
      .attach('audio', AUDIO, { filename: 'clip.m4a', contentType: 'audio/m4a' })
      .expect(202);
    expect(res.body).toMatchObject({ queued: true, clip: { firstPass: 'phone', serverPass: { status: 'queued' } } });
  }
  // Retried upload is a duplicate, not a second clip.
  await request(app)
    .post(`/api/v1/cases/${caseId}/clips?firstPass=phone`)
    .set(auth)
    .field('section', 'road')
    .field('clientId', `${caseId}-road`)
    .attach('audio', AUDIO, { filename: 'clip.m4a', contentType: 'audio/m4a' })
    .expect(200);
  await idle();

  const before = await getCase(caseId);
  expect(valueOf(before, 'skid_marks_m')).toBe(2); // proposals never change case values

  const pulled = (await request(app).get('/api/v1/sync/pull').set(auth).expect(200)).body;
  const mine = pulled.proposals.filter((p) => p.caseId === caseId);
  expect(Object.fromEntries(mine.map((p) => [p.fieldId, [p.currentValue ?? null, p.value]]))).toEqual({
    road_name_number: [null, 'NH-27'],
    skid_marks_m: [2, 12],
    'registration_number@2': [null, 'AS01 CD 5678'],
  });
  expect(mine.every((p) => p.status === 'open' && p.source === 'server_asr')).toBe(true);
  expect(mine.find((p) => p.fieldId === 'skid_marks_m').evidence.transcriptSpan.text).toBe('পিছলাৰ দাগ প্ৰায় ১২');
  expect(pulled.cases.find((c) => c.caseId === caseId).followups.map((f) => f.fieldIds[0])).toContain('registration_number@1');

  // The officer accepts one and rejects one on the phone.
  const skid = mine.find((p) => p.fieldId === 'skid_marks_m');
  const road = mine.find((p) => p.fieldId === 'road_name_number');
  await push([
    fieldOp(caseId, 'skid_marks_m', 12, { confirmedByOfficer: true, updatedAt: at(20) }),
    op(caseId, 'proposal', 'decide', { proposalId: skid.id, status: 'accepted', at: at(20) }),
    op(caseId, 'proposal', 'decide', { proposalId: road.id, status: 'rejected', at: at(20) }),
  ]).expect(200);
  const next = (await request(app).get(`/api/v1/sync/pull?since=${encodeURIComponent(pulled.cursor)}`).set(auth).expect(200)).body;
  const decided = Object.fromEntries(next.proposals.filter((p) => p.caseId === caseId).map((p) => [p.fieldId, p.status]));
  expect(decided).toMatchObject({ skid_marks_m: 'accepted', road_name_number: 'rejected' });
  expect(valueOf(await getCase(caseId), 'skid_marks_m')).toBe(12);
});

test('signing through sync needs every field confirmed; then the case is locked but evidence from before signing still uploads', async () => {
  const caseId = 'case-ops-004';
  await push([
    op(caseId, 'case', 'create', { startedAt: STARTED }),
    fieldOp(caseId, 'weather', 'rain'),
  ]).expect(200);
  const early = (await push([op(caseId, 'case', 'sign', { signedAt: at(30) })]).expect(200)).body;
  expect(early.results[0]).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/not confirmed/) });

  const signed = (
    await push([
      fieldOp(caseId, 'weather', 'rain', { confirmedByOfficer: true, updatedAt: at(31) }),
      op(caseId, 'case', 'sign', { signedAt: at(32) }),
      op(caseId, 'audit', 'append', { type: 'case_signed', at: at(32) }),
      fieldOp(caseId, 'weather', 'fog', { source: 'officer_edit', confirmedByOfficer: true, updatedAt: at(33) }),
    ]).expect(200)
  ).body;
  expect(signed.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'rejected']);
  expect(signed.cases[0].status).toBe('signed');

  const upload = (recordedAt) =>
    request(app)
      .post(`/api/v1/cases/${caseId}/clips?firstPass=phone`)
      .set(auth)
      .field('section', 'road')
      .field('clientId', `${caseId}-${recordedAt.slice(14, 16)}`)
      .field('recordedAt', recordedAt)
      .attach('audio', AUDIO, { filename: 'clip.m4a', contentType: 'audio/m4a' });
  const before = await upload(at(10)).expect(201);
  expect(before.body.clip.serverPass.status).toBe('skipped');
  await upload(at(40)).expect(409);
  // Server-first uploads to a signed case are still refused outright.
  await request(app)
    .post(`/api/v1/cases/${caseId}/clips`)
    .set(auth)
    .field('section', 'road')
    .attach('audio', AUDIO, { filename: 'clip.m4a', contentType: 'audio/m4a' })
    .expect(409);
});

test('a sync body must be either whole cases or ops', async () => {
  await request(app).post('/api/v1/sync/cases').set(auth).send({}).expect(400);
  await request(app)
    .post('/api/v1/sync/cases')
    .set(auth)
    .send({ ops: [{ opId: 'x', caseId: 'case-x', entity: 'field', op: 'drop_table', createdAt: at(0), payload: {} }] })
    .expect(400);
});
