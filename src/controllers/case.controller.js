import * as caseService from '../services/case.service.js';

export async function create(req, res) {
  const { caseDoc, created } = await caseService.createCase(req.officer, req.body);
  res.status(created ? 201 : 200).json({ case: caseDoc, created });
}

export async function list(req, res) {
  res.json(await caseService.listCases(req.officer, req.valid.query));
}

export async function get(req, res) {
  res.json({ case: await caseService.getCase(req.params.id, req.officer) });
}

export async function audit(req, res) {
  res.json({ items: await caseService.getAudit(req.params.id, req.officer) });
}
