import * as followupService from '../services/followup.service.js';

export async function list(req, res) {
  res.json(await followupService.list(req.params.id, req.officer, req.valid.query.status));
}

export async function answer(req, res) {
  res.json(await followupService.answer(req.params.id, req.officer, req.params.fid, req.body, req.file));
}

export async function skip(req, res) {
  res.json(await followupService.skip(req.params.id, req.officer, req.params.fid, req.body.reason));
}
