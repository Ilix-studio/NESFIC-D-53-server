import * as reviewService from '../services/review.service.js';

export async function edit(req, res) {
  res.json(await reviewService.editField(req.params.id, req.officer, req.params.fieldId, req.body));
}

export async function confirm(req, res) {
  res.json(await reviewService.confirmField(req.params.id, req.officer, req.params.fieldId));
}

export async function sign(req, res) {
  res.json({ case: await reviewService.sign(req.params.id, req.officer) });
}
