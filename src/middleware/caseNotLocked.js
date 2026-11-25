import * as caseService from '../services/case.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Rejects changes to signed cases with 409 before any upload is stored.
 * Services check again, so this is an early exit, not the only guard.
 */
export const caseNotLocked = asyncHandler(async (req, res, next) => {
  await caseService.assertWritable(req.params.id, req.officer);
  next();
});

/**
 * Same, except phone-first uploads (?firstPass=phone) of evidence captured offline: those may
 * reach a signed case if they were captured before signing (the service checks the time).
 */
export const caseNotLockedUnlessPhoneEvidence = asyncHandler(async (req, res, next) => {
  if (req.query.firstPass === 'phone') await caseService.findAccessible(req.params.id, req.officer, { write: true });
  else await caseService.assertWritable(req.params.id, req.officer);
  next();
});
