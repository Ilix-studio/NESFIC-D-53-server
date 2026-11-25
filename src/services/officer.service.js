// Account creation. There is no public sign-up: an admin creates any account, a supervisor
// creates IO accounts in their own district. The IO records their voiceprint after first login.
import { Officer } from '../models/Officer.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword } from './auth.service.js';

export async function createOfficer(actor, { badgeNo, password, name, policeStation, district, role = 'io' }) {
  if (actor.role === 'supervisor') {
    if (role !== 'io') throw ApiError.forbidden('Supervisors can create IO accounts only');
    if (district && district !== actor.district) throw ApiError.forbidden('Supervisors can create accounts in their own district only');
    district = actor.district;
  } else if (actor.role !== 'admin') {
    throw ApiError.forbidden('Only an admin or a supervisor can create accounts');
  }
  if (!district) throw ApiError.badRequest('district is required');
  if (await Officer.exists({ badgeNo })) throw ApiError.conflict('An account with this badge number already exists');
  return Officer.create({ badgeNo, passwordHash: await hashPassword(password), name, policeStation, district, role, createdBy: actor._id });
}
