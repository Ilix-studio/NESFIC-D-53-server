// End-to-end API flow on an in-memory MongoDB (no real database needed).
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { upsertOfficer } from '../src/services/auth.service.js';

const AUDIO = Buffer.alloc(1024, 1); // the mock ASR ignores audio content
let mongo;
let app;
let auth;
let otherAuth;

const login = async (badgeNo, password) => {
  const res = await request(app).post('/api/v1/auth/login').send({ badgeNo, password }).expect(200);
  return { Authorization: `Bearer ${res.body.token}` };
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  app = createApp();
  await upsertOfficer({ badgeNo: 'T-1', password: 'secret-1', name: 'Test IO', policeStation: 'Test PS', district: 'Kamrup (Metro)' });
  await upsertOfficer({ badgeNo: 'T-2', password: 'secret-2', name: 'Other IO', policeStation: 'Other PS', district: 'Nagaon' });
  auth = await login('T-1', 'secret-1');
  otherAuth = await login('T-2', 'secret-2');
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('health reports the database and the placeholder schema', async () => {
  const res = await request(app).get('/api/v1/health').expect(200);
  expect(res.body).toMatchObject({ status: 'ok', db: 'connected', schema: { placeholder: true } });
});

test('login rejects a wrong password, and routes need a token', async () => {
  await request(app).post('/api/v1/auth/login').send({ badgeNo: 'T-1', password: 'nope' }).expect(401);
  await request(app).get('/api/v1/cases').expect(401);
  const me = await request(app).get('/api/v1/auth/me').set(auth).expect(200);
  expect(me.body.officer).toMatchObject({ badgeNo: 'T-1', policeStation: 'Test PS' });
  expect(me.body.officer.passwordHash).toBeUndefined();
});

test('full case: record 4 sections, answer follow-ups, confirm, sign, export', async () => {
  const clientId = 'case-e2e-001';
  const created = await request(app)
    .post('/api/v1/cases')
    .set(auth)
    .send({ clientId, startedAt: '2026-11-23T15:44:00Z', location: { lat: 26.14, lng: 91.73, accuracy: 10 } })
    .expect(201);
  expect(created.body.case.fields.map((f) => f.fieldId)).toEqual(['police_station', 'district', 'crash_location']);
  // creating again with the same clientId is idempotent
  await request(app).post('/api/v1/cases').set(auth).send({ clientId, startedAt: '2026-11-23T15:44:00Z' }).expect(200);

  for (const section of ['crash', 'road', 'vehicles', 'persons']) {
    const res = await request(app)
      .post(`/api/v1/cases/${clientId}/clips`)
      .set(auth)
      .field('section', section)
      .field('clientId', `${clientId}-${section}`)
      .attach('audio', AUDIO, { filename: 'clip.m4a', contentType: 'audio/m4a' })
      .expect(201);
    expect(res.body.clip.processingStatus).toBe('done');
    expect(res.body.filledFields.length).toBeGreaterThanOrEqual(8);
    expect(res.body.clip.filePath).toBeUndefined();
  }

  const open = (await request(app).get(`/api/v1/cases/${clientId}/followups`).set(auth).expect(200)).body.items;
  expect(open.map((f) => [f.ruleId, f.fieldIds[0]])).toEqual([
    ['nightButDaylight', 'lighting'],
    ['requiredMissing', 'registration_number@1'],
  ]);

  await request(app)
    .post(`/api/v1/cases/${clientId}/followups/${open[0]._id}/answer`)
    .set(auth)
    .send({ code: 'night_lights_not_working' })
    .expect(200);
  const voice = await request(app)
    .post(`/api/v1/cases/${clientId}/followups/${open[1]._id}/answer`)
    .set(auth)
    .attach('audio', AUDIO, { filename: 'answer.m4a', contentType: 'audio/m4a' })
    .expect(200);
  expect(voice.body).toMatchObject({ understood: true, field: { value: 'AS01 AB 1234', source: 'speech' }, followups: [] });

  const signTooEarly = await request(app).post(`/api/v1/cases/${clientId}/sign`).set(auth).expect(409);
  expect(signTooEarly.body.error.details.unconfirmed.length).toBeGreaterThan(30);

  const { case: full } = (await request(app).get(`/api/v1/cases/${clientId}`).set(auth).expect(200)).body;
  for (const f of full.fields) {
    await request(app).post(`/api/v1/cases/${clientId}/fields/${encodeURIComponent(f.fieldId)}/confirm`).set(auth).expect(200);
  }
  await request(app).get(`/api/v1/cases/${clientId}/export/edar`).set(auth).expect(409);
  const signed = await request(app).post(`/api/v1/cases/${clientId}/sign`).set(auth).expect(200);
  expect(signed.body.case).toMatchObject({ status: 'signed', locked: true });

  await request(app).patch(`/api/v1/cases/${clientId}/fields/weather`).set(auth).send({ value: 'fog' }).expect(409);
  await request(app)
    .post(`/api/v1/cases/${clientId}/clips`)
    .set(auth)
    .field('section', 'road')
    .attach('audio', AUDIO, { filename: 'late.m4a', contentType: 'audio/m4a' })
    .expect(409);

  const exported = await request(app).get(`/api/v1/cases/${clientId}/export/edar`).set(auth).expect(200);
  expect(exported.headers['content-disposition']).toContain(`edar-${clientId}.json`);
  expect(exported.body).toMatchObject({
    schema: { placeholder: true },
    road: { lighting: 'night_lights_not_working', weather: 'rain' },
    case: { signedBy: { badgeNo: 'T-1' } },
  });
  expect(exported.body.vehicles.map((v) => v.registration_number)).toEqual(['AS01 AB 1234', 'AS01 CD 5678']);

  const audit = (await request(app).get(`/api/v1/cases/${clientId}/audit`).set(auth).expect(200)).body.items;
  const types = new Set(audit.map((e) => e.type));
  for (const t of ['case_opened', 'clip_saved', 'fields_filled', 'followup_answered', 'field_confirmed', 'case_signed', 'case_exported']) {
    expect(types).toContain(t);
  }
  const lightingChange = audit.find((e) => e.type === 'followup_answered' && e.fieldId === 'lighting');
  expect(lightingChange).toMatchObject({ oldValue: 'daylight', newValue: 'night_lights_not_working' });

  // another officer cannot see this case
  await request(app).get(`/api/v1/cases/${clientId}`).set(otherAuth).expect(404);
});

test('a skipped question needs a reason and stays skipped', async () => {
  const clientId = 'case-skip-001';
  await request(app).post('/api/v1/cases').set(auth).send({ clientId, startedAt: '2026-11-23T15:44:00Z' }).expect(201);
  const [first] = (await request(app).get(`/api/v1/cases/${clientId}/followups`).set(auth)).body.items;
  await request(app).post(`/api/v1/cases/${clientId}/followups/${first._id}/skip`).set(auth).send({ reason: '' }).expect(400);
  await request(app)
    .post(`/api/v1/cases/${clientId}/followups/${first._id}/skip`)
    .set(auth)
    .send({ reason: 'rider taken to hospital before IO arrived' })
    .expect(200);
  const skipped = (await request(app).get(`/api/v1/cases/${clientId}/followups?status=skipped`).set(auth)).body.items;
  expect(skipped).toEqual([expect.objectContaining({ _id: first._id, skipReason: 'rider taken to hospital before IO arrived' })]);
});

test('sync upserts by clientId and never replaces newer data with older data', async () => {
  const clientId = 'case-sync-001';
  const send = (fields, status = 'draft') =>
    request(app).post('/api/v1/sync/cases').set(auth).send({ cases: [{ clientId, startedAt: '2026-11-23T15:44:00Z', status, fields }] }).expect(200);

  const first = await send([
    { fieldId: 'weather', value: 'rain', source: 'officer_edit', confirmedByOfficer: true, updatedAt: '2026-11-23T16:00:00Z' },
    { fieldId: 'made_up_field', value: 'x', source: 'speech', updatedAt: '2026-11-23T16:00:00Z' },
  ]);
  expect(first.body.results[0]).toMatchObject({ status: 'created', fieldsApplied: 1, rejected: [{ fieldId: 'made_up_field' }] });

  const older = await send([{ fieldId: 'weather', value: 'clear', source: 'speech', updatedAt: '2026-11-23T15:50:00Z' }]);
  expect(older.body.results[0]).toMatchObject({ status: 'updated', fieldsApplied: 0 });
  const { case: c } = (await request(app).get(`/api/v1/cases/${clientId}`).set(auth)).body;
  expect(c.fields.find((f) => f.fieldId === 'weather').value).toBe('rain');
});

test('audit events are append-only', async () => {
  const event = await AuditEvent.findOne();
  await expect(AuditEvent.updateOne({ _id: event._id }, { type: 'case_opened' })).rejects.toThrow('append-only');
  await expect(AuditEvent.deleteMany({})).rejects.toThrow('append-only');
  await expect(AuditEvent.findOneAndDelete({ _id: event._id })).rejects.toThrow('append-only');
  await expect(event.deleteOne()).rejects.toThrow('append-only');
  event.meta = { changed: true };
  await expect(event.save()).rejects.toThrow('append-only');
  expect(await AuditEvent.countDocuments()).toBeGreaterThan(0);
});

test('uploads are checked: wrong type is rejected', async () => {
  await request(app).post('/api/v1/cases').set(auth).send({ clientId: 'case-upload-001', startedAt: '2026-11-23T15:44:00Z' }).expect(201);
  const res = await request(app)
    .post('/api/v1/cases/case-upload-001/clips')
    .set(auth)
    .field('section', 'crash')
    .attach('audio', Buffer.from('not audio'), { filename: 'x.exe', contentType: 'application/octet-stream' })
    .expect(400);
  expect(res.body.error.message).toMatch(/Unsupported file type/);
});

test('photos: stored once per clientId, no file paths in responses, owner only', async () => {
  const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]); // JPEG-shaped bytes; nothing decodes them
  const photosDir = path.join(process.env.UPLOAD_DIR, 'photos');
  await request(app).post('/api/v1/cases').set(auth).send({ clientId: 'case-photo-001', startedAt: '2026-11-23T15:44:00Z' }).expect(201);
  const upload = (who) =>
    request(app)
      .post('/api/v1/cases/case-photo-001/photos')
      .set(who)
      .field('checklistItem', 'skid_marks')
      .field('clientId', 'photo-001')
      .field('takenAt', '2026-11-23T15:50:00Z')
      .field('lat', '26.14')
      .field('lng', '91.73')
      .attach('photo', PHOTO, { filename: 'scene.jpg', contentType: 'image/jpeg' });

  const first = await upload(auth).expect(201);
  expect(first.body.photo).toMatchObject({ checklistItem: 'skid_marks', storage: 'local' });
  expect(first.body.photo.filePath).toBeUndefined();
  const again = await upload(auth).expect(200);
  expect(again.body).toMatchObject({ created: false, photo: { _id: first.body.photo._id } });
  await upload(otherAuth).expect(404);
  expect(await readdir(photosDir)).toHaveLength(1); // the repeat and the rejected upload stored nothing

  const fileUrl = `/api/v1/cases/case-photo-001/photos/${first.body.photo._id}/file`;
  const file = await request(app).get(fileUrl).set(auth).expect(200);
  expect(file.headers['content-type']).toMatch(/^image\/jpeg/);
  expect(Buffer.compare(file.body, PHOTO)).toBe(0);
  await request(app).get(fileUrl).set(otherAuth).expect(404);
});
