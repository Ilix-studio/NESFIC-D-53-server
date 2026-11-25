// Express 5 already forwards rejected promises to the error handler; this keeps
// middleware and controllers explicit about it and works if a handler is reused elsewhere.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
