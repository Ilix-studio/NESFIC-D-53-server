import * as authService from '../services/auth.service.js';

export async function login(req, res) {
  res.json(await authService.login(req.body.badgeNo, req.body.password));
}

export function me(req, res) {
  res.json({ officer: req.officer });
}
