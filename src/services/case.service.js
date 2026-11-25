import mongoose from 'mongoose';

import { Case } from '../models/Case.js';
import { toPoint } from '../models/geo.js';
import { Photo } from '../models/Photo.js';
import { getSchema } from '../schema/index.js';
import { ApiError } from '../utils/ApiError.js';
import * as audit from './audit.service.js';
import { recheck, setFieldValue } from './caseState.js';
import { locatePhoto, removePhoto, savePhoto } from './photoStorage/index.js';

function canRead(caseDoc, officer) {
  if (caseDoc.officer.equals(officer._id)) return true;
  if (officer.role === 'admin') return true;
  return officer.role === 'supervisor' && caseDoc.district === officer.district;
}

/** Finds a case by server id or by the phone's clientId, if this officer may see it. */
export async function findAccessible(idOrClientId, officer, { write = false } = {}) {
  const query = mongoose.isObjectIdOrHexString(idOrClientId) ? { _id: idOrClientId } : { clientId: idOrClientId };
  const caseDoc = await Case.findOne(query);
  if (!caseDoc || !canRead(caseDoc, officer)) throw ApiError.notFound('Case not found');
  if (write && !caseDoc.officer.equals(officer._id)) {
    throw ApiError.forbidden('Only the investigating officer can change this case');
  }
  return caseDoc;
}

/** Same as findAccessible for writing, and rejects signed cases with 409. */
export async function assertWritable(idOrClientId, officer) {
  const caseDoc = await findAccessible(idOrClientId, officer, { write: true });
  if (caseDoc.locked) throw ApiError.conflict('This case is signed and locked for editing');
  return caseDoc;
}

/**
 * For evidence the phone captured offline (clips, photos): the officer's own case, and once it
 * is signed, only files captured before signing (uploading them completes the record).
 */
export async function findForEvidence(idOrClientId, officer, capturedAt) {
  const caseDoc = await findAccessible(idOrClientId, officer, { write: true });
  const beforeSigning = capturedAt && caseDoc.signedAt && new Date(capturedAt) <= caseDoc.signedAt;
  if (caseDoc.locked && !beforeSigning) throw ApiError.conflict('This case is signed and locked for editing');
  return caseDoc;
}

export async function createCase(officer, { clientId, startedAt, location }) {
  const existing = await Case.findOne({ clientId });
  if (existing) {
    if (!existing.officer.equals(officer._id)) throw ApiError.conflict('clientId is already in use');
    return { caseDoc: existing, created: false };
  }

  const caseDoc = new Case({
    clientId,
    officer: officer._id,
    policeStation: officer.policeStation,
    district: officer.district,
    startedAt,
    location: toPoint(location),
    schemaVersion: getSchema().version,
    langPack: 'as',
  });
  setFieldValue(caseDoc, 'police_station', officer.policeStation, { source: 'auto' });
  setFieldValue(caseDoc, 'district', officer.district, { source: 'auto' });
  if (location) setFieldValue(caseDoc, 'crash_location', location, { source: 'auto' });
  recheck(caseDoc);
  await caseDoc.save();

  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'case_opened',
    meta: { startedAt, gps: Boolean(location) },
  });
  return { caseDoc, created: true };
}

export async function listCases(officer, { page, limit }) {
  const filter =
    officer.role === 'admin' ? {} : officer.role === 'supervisor' ? { district: officer.district } : { officer: officer._id };
  const [items, total] = await Promise.all([
    Case.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('clientId status startedAt completeness policeStation district signedAt createdAt updatedAt')
      .lean(),
    Case.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function getCase(idOrClientId, officer) {
  return findAccessible(idOrClientId, officer);
}

export async function addPhoto(idOrClientId, officer, file, body, { firstPass = 'server' } = {}) {
  const caseDoc =
    firstPass === 'phone' ? await findForEvidence(idOrClientId, officer, body.takenAt) : await assertWritable(idOrClientId, officer);
  if (body.clientId) {
    const existing = await Photo.findOne({ case: caseDoc._id, clientId: body.clientId });
    if (existing) return { photo: existing, created: false };
  }
  const location = body.lat != null && body.lng != null ? { lat: body.lat, lng: body.lng, accuracy: body.accuracy } : undefined;
  // The file is still in memory (multer): store it only now that the case checks have passed.
  const stored = await savePhoto(file);
  let photo;
  try {
    photo = await Photo.create({
      case: caseDoc._id,
      clientId: body.clientId,
      checklistItem: body.checklistItem,
      ...stored,
      mimeType: file.mimetype,
      takenAt: body.takenAt,
      location: toPoint(location),
      note: body.note,
    });
  } catch (err) {
    await removePhoto(stored); // e.g. the same clientId uploaded twice at once
    throw err;
  }
  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'photo_added',
    meta: { photoId: photo._id, checklistItem: photo.checklistItem, gps: Boolean(location) },
  });
  return { photo, created: true };
}

export async function listPhotos(idOrClientId, officer) {
  const caseDoc = await findAccessible(idOrClientId, officer);
  return Photo.find({ case: caseDoc._id }).sort({ takenAt: 1 });
}

export async function getPhotoFile(idOrClientId, officer, photoId) {
  const caseDoc = await findAccessible(idOrClientId, officer);
  const photo = mongoose.isObjectIdOrHexString(photoId) ? await Photo.findOne({ _id: photoId, case: caseDoc._id }) : null;
  if (!photo) throw ApiError.notFound('Photo not found');
  return { ...locatePhoto(photo), mimeType: photo.mimeType };
}

export async function getAudit(idOrClientId, officer) {
  const caseDoc = await findAccessible(idOrClientId, officer);
  return audit.listForCase(caseDoc._id);
}
