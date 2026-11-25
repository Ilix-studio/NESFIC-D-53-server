import { ApiError } from '../utils/ApiError.js';

/**
 * Validates req[where] with a zod schema, or with pick(req) => schema when the schema depends
 * on the request. Parsed values go to req.valid[where] (req.query is read-only in Express 5);
 * req.body is also replaced with the parsed body.
 */
export const validate = (schemaOrPick, where = 'body') => (req, res, next) => {
  const schema = typeof schemaOrPick === 'function' ? schemaOrPick(req) : schemaOrPick;
  const result = schema.safeParse(req[where] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(ApiError.badRequest(`Invalid request ${where}`, details));
  }
  req.valid = { ...req.valid, [where]: result.data };
  if (where === 'body') req.body = result.data;
  next();
};
