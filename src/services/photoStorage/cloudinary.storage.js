// Photos on Cloudinary as "authenticated" assets: there is no public URL, and a download is a
// signed link that expires. Names are random; no case or personal data goes to Cloudinary.
import { randomUUID } from 'node:crypto';

import { v2 as cloudinary } from 'cloudinary';

import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

const LINK_TTL_SECONDS = 5 * 60;
const ASSET = { type: 'authenticated', resource_type: 'image' };

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const cloudinaryStore = {
  name: 'cloudinary',
  save({ buffer }) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ ...ASSET, folder: env.CLOUDINARY_FOLDER, public_id: randomUUID(), overwrite: false }, (err, result) => {
          if (err) {
            // Cloudinary's message names the problem (bad key, quota, timeout), never the photo.
            console.error(`Cloudinary upload failed: ${err.http_code ?? ''} ${err.message}`);
            return reject(new ApiError(502, 'Photo storage is unavailable, try again'));
          }
          resolve({ storage: 'cloudinary', cloudinary: { publicId: result.public_id, format: result.format } });
        })
        .end(buffer);
    });
  },
  async remove(photo) {
    await cloudinary.uploader.destroy(photo.cloudinary.publicId, { ...ASSET, invalidate: true }).catch(() => {});
  },
  locate(photo) {
    const { publicId, format } = photo.cloudinary;
    const expires_at = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
    return { url: cloudinary.utils.private_download_url(publicId, format, { ...ASSET, expires_at }) };
  },
};
