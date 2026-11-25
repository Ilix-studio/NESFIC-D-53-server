import { unlink } from 'node:fs/promises';

import multer from 'multer';

import { ApiError } from '../utils/ApiError.js';

export function notFound(req, res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.path}`));
}

// Never log request bodies, transcripts or personal data: only the error name and stack.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Internal server error';
  let details;

  if (err instanceof ApiError) {
    ({ status, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.message;
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = 'Invalid data';
    details = Object.values(err.errors ?? {}).map((e) => ({ path: e.path, message: e.kind }));
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate record';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Body is not valid JSON';
  } else if (err.status >= 400 && err.status < 500) {
    status = err.status;
    message = err.expose ? err.message : 'Bad request';
  }

  if (status >= 500) console.error(err.stack ?? err.name);
  // A rejected request must not leave its upload behind.
  if (req.file?.path) unlink(req.file.path).catch(() => {});
  res.status(status).json({ error: { message, ...(details ? { details } : {}) } });
}
