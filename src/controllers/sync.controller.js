import * as syncService from '../services/sync.service.js';

// Body is either { cases } (whole cases) or { ops } (the phone's outbox).
export async function cases(req, res) {
  const { ops, cases: whole } = req.body;
  res.json(ops ? await syncService.applyOps(req.officer, ops) : await syncService.syncCases(req.officer, whole));
}

export async function pull(req, res) {
  res.json(await syncService.pull(req.officer, req.valid.query.since));
}
