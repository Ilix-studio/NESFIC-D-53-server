import * as authService from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Verifies "Authorization: Bearer <jwt>" and sets req.officer. */
export const requireAuth = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized();
  req.officer = await authService.officerFromToken(token);
  next();
});
