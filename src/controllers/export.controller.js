import * as exportService from '../services/export.service.js';

export async function edar(req, res) {
  const { filename, json } = await exportService.exportEdar(req.params.id, req.officer);
  res.attachment(filename).json(json);
}
