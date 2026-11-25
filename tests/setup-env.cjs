// Runs before each test file, before any app module reads the environment.
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://set-by-mongodb-memory-server/test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.ASR_ENGINE = 'mock';
process.env.MAPPER_ENGINE = 'rule';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `voicedar-test-uploads-${process.pid}`);
