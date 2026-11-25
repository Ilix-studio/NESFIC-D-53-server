// PhotoStorage: save(file) -> fields for the Photo row, remove(photo), locate(photo) -> { filePath } | { url }
// New photos go to PHOTO_STORAGE; older ones are read and removed from wherever they were saved.
import { env } from '../../config/env.js';
import { cloudinaryStore } from './cloudinary.storage.js';
import { localStore } from './local.storage.js';

const stores = { local: localStore, cloudinary: cloudinaryStore };
const storeFor = (photo) => stores[photo.storage ?? 'local'];

export const savePhoto = (file) => stores[env.PHOTO_STORAGE].save(file);
export const removePhoto = (photo) => storeFor(photo).remove(photo);
export const locatePhoto = (photo) => storeFor(photo).locate(photo);
