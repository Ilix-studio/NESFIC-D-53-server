import * as modelsService from '../services/models.service.js';

export function list(req, res) {
  res.json({ items: modelsService.listModels() });
}

export function file(req, res) {
  // sendFile handles Range requests, so an interrupted download can resume.
  res.type('application/octet-stream').sendFile(modelsService.getModelFile(req.params.modelId), { maxAge: '30d', immutable: true });
}
