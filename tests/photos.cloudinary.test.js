// PHOTO_STORAGE=cloudinary with the Cloudinary SDK mocked: nothing leaves the machine.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

// Own upload folder, so the check that nothing is written locally does not see other test files' photos.
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `voicedar-test-cloud-${process.pid}`);
process.env.PHOTO_STORAGE = 'cloudinary';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const uploads = [];
let failNextUpload = false;
const destroy = jest.fn(async () => ({ result: 'ok' }));
jest.unstable_mockModule('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (options, callback) => ({
        end(buffer) {
          if (failNextUpload) {
            failNextUpload = false;
            return callback({ http_code: 401, message: 'Invalid api_key' });
          }
          uploads.push({ options, bytes: buffer.length });
          callback(null, { public_id: `${options.folder}/${options.public_id}`, format: 'jpg' });
        },
      }),
      destroy,
    },
    utils: {
      private_download_url: (publicId, format, { type, expires_at }) =>
        `https://api.cloudinary.com/v1_1/test-cloud/image/download?public_id=${publicId}&format=${format}&type=${type}&expires_at=${expires_at}`,
    },
  },
}));

// App modules read the environment and the SDK, so they load after both are set.
const { createApp } = await import('../src/app.js');
const { connectDb } = await import('../src/config/db.js');
const { Photo } = await import('../src/models/Photo.js');
const { upsertOfficer } = await import('../src/services/auth.service.js');

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
let mongo;
let app;
let auth;
let otherAuth;

const login = async (badgeNo, password) => {
  const res = await request(app).post('/api/v1/auth/login').send({ badgeNo, password }).expect(200);
  return { Authorization: `Bearer ${res.body.token}` };
};

const upload = (who, clientId) =>
  request(app)
    .post('/api/v1/cases/case-cloud-001/photos')
    .set(who)
    .field('checklistItem', 'number_plates')
    .field('clientId', clientId)
    .field('takenAt', '2026-11-23T15:50:00Z')
    .attach('photo', PHOTO, { filename: 'scene.jpg', contentType: 'image/jpeg' });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  app = createApp();
  await upsertOfficer({ badgeNo: 'C-1', password: 'secret-1', name: 'Test IO', policeStation: 'Test PS', district: 'Kamrup (Metro)' });
  await upsertOfficer({ badgeNo: 'C-2', password: 'secret-2', name: 'Other IO', policeStation: 'Other PS', district: 'Nagaon' });
  auth = await login('C-1', 'secret-1');
  otherAuth = await login('C-2', 'secret-2');
  await request(app).post('/api/v1/cases').set(auth).send({ clientId: 'case-cloud-001', startedAt: '2026-11-23T15:44:00Z' }).expect(201);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('a photo goes to Cloudinary as a private asset with a random name, once per clientId', async () => {
  const first = await upload(auth, 'cloud-photo-1').expect(201);
  expect(uploads).toHaveLength(1);
  const { options, bytes } = uploads[0];
  expect(options).toMatchObject({ type: 'authenticated', resource_type: 'image', folder: 'voicedar/photos', overwrite: false });
  expect(options.public_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(bytes).toBe(PHOTO.length);
  expect(first.body.photo).toMatchObject({ storage: 'cloudinary', checklistItem: 'number_plates' });
  expect(first.body.photo.cloudinary).toBeUndefined();
  expect(existsSync(path.join(process.env.UPLOAD_DIR, 'photos'))).toBe(false);

  await upload(auth, 'cloud-photo-1').expect(200);
  await upload(otherAuth, 'cloud-photo-2').expect(404);
  expect(uploads).toHaveLength(1);
});

test('download redirects to a signed link that expires within 5 minutes', async () => {
  const photo = await Photo.findOne({ clientId: 'cloud-photo-1' });
  const res = await request(app).get(`/api/v1/cases/case-cloud-001/photos/${photo._id}/file`).set(auth).expect(302);
  const link = new URL(res.headers.location);
  expect(link.searchParams.get('public_id')).toBe(photo.cloudinary.publicId);
  expect(link.searchParams.get('type')).toBe('authenticated');
  const ttl = Number(link.searchParams.get('expires_at')) - Date.now() / 1000;
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(300);
  expect(res.headers['cache-control']).toBe('no-store');
  await request(app).get(`/api/v1/cases/case-cloud-001/photos/${photo._id}/file`).set(otherAuth).expect(404);
});

test('a Cloudinary failure returns 502 so the phone retries, and saves no row', async () => {
  failNextUpload = true;
  const res = await upload(auth, 'cloud-photo-3').expect(502);
  expect(res.body.error.message).toMatch(/try again/);
  expect(await Photo.countDocuments({ clientId: 'cloud-photo-3' })).toBe(0);
});

test('if the row cannot be saved, the uploaded file is deleted from Cloudinary', async () => {
  jest.spyOn(Photo, 'create').mockRejectedValueOnce(new Error('database unavailable'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await upload(auth, 'cloud-photo-4').expect(500);
  const { options } = uploads.at(-1);
  expect(destroy).toHaveBeenCalledWith(`voicedar/photos/${options.public_id}`, expect.objectContaining({ type: 'authenticated', invalidate: true }));
});
