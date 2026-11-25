import * as clipService from '../services/clip.service.js';

export async function upload(req, res) {
  const result = await clipService.processClip(req.params.id, req.officer, req.file, req.body, { firstPass: req.query.firstPass });
  res.status(result.duplicate ? 200 : result.queued ? 202 : 201).json(result);
}

export async function list(req, res) {
  res.json({ items: await clipService.listClips(req.params.id, req.officer) });
}

export async function audio(req, res) {
  const { filePath, mimeType } = await clipService.getClipAudio(req.params.id, req.officer, req.params.clipId);
  res.type(mimeType).sendFile(filePath);
}
