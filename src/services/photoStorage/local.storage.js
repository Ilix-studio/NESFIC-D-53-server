// Photos in UPLOAD_DIR/photos (never served statically) with random file names.
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../../config/env.js';

const dir = path.join(env.UPLOAD_DIR, 'photos');

export const localStore = {
  name: 'local',
  async save({ buffer, mimetype }) {
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${randomUUID()}${mimetype === 'image/png' ? '.png' : '.jpg'}`);
    await writeFile(filePath, buffer, { flag: 'wx' });
    return { storage: 'local', filePath };
  },
  async remove(photo) {
    await unlink(photo.filePath).catch(() => {});
  },
  locate: (photo) => ({ filePath: photo.filePath }),
};
