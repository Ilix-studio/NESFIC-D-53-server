import * as officerService from '../services/officer.service.js';

export async function create(req, res) {
  res.status(201).json({ officer: await officerService.createOfficer(req.officer, req.body) });
}
