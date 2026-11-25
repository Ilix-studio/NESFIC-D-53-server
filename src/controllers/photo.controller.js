import * as caseService from '../services/case.service.js';

export async function upload(req, res) {
  const { photo, created } = await caseService.addPhoto(req.params.id, req.officer, req.file, req.body, { firstPass: req.query.firstPass });
  res.status(created ? 201 : 200).json({ photo, created });
}

export async function list(req, res) {
  res.json({ items: await caseService.listPhotos(req.params.id, req.officer) });
}

export async function file(req, res) {
  const { filePath, url, mimeType } = await caseService.getPhotoFile(req.params.id, req.officer, req.params.photoId);
  // Cloudinary: a signed link that expires in a few minutes; never cache it.
  if (url) return res.set('Cache-Control', 'no-store').redirect(url);
  res.type(mimeType).sendFile(filePath);
}
