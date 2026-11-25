import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { Officer } from '../models/Officer.js';
import { ApiError } from '../utils/ApiError.js';

// Compared against when the badge number does not exist, so both paths take similar time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function login(badgeNo, password) {
  const officer = await Officer.findOne({ badgeNo }).select('+passwordHash');
  const ok = await bcrypt.compare(password, officer?.passwordHash ?? DUMMY_HASH);
  if (!officer || !ok) throw ApiError.unauthorized('Wrong badge number or password');
  const token = jwt.sign({ sub: officer.id, role: officer.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
  return { token, expiresIn: env.JWT_EXPIRES_IN, officer: officer.toJSON() };
}

export async function officerFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('Session expired or invalid, please log in again');
  }
  const officer = mongoose.isObjectIdOrHexString(payload.sub) ? await Officer.findById(payload.sub) : null;
  if (!officer) throw ApiError.unauthorized('Officer account not found');
  return officer;
}

export async function upsertOfficer({ badgeNo, password, name, policeStation, district, role = 'io' }) {
  const passwordHash = await hashPassword(password);
  return Officer.findOneAndUpdate(
    { badgeNo },
    { badgeNo, passwordHash, name, policeStation, district, role },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  );
}
