import * as voiceService from '../services/voice.service.js';

export function passages(req, res) {
  res.json(voiceService.listPassages());
}

export async function enrol(req, res) {
  res.json({ officer: await voiceService.enrol(req.officer, req.file, req.body) });
}
