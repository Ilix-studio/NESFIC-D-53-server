// Language packs are data. Adding Bengali or Bodo means adding bn.json / brx.json next to as.json.
import { existsSync, readFileSync } from 'node:fs';

const cache = new Map();

export function getLang(code) {
  if (!cache.has(code)) {
    const url = new URL(`./${code}.json`, import.meta.url);
    if (!existsSync(url)) throw new Error(`No language pack for "${code}"`);
    cache.set(code, JSON.parse(readFileSync(url, 'utf8')));
  }
  return cache.get(code);
}

/** fill('{n} vehicles', { n: 2 }) -> '2 vehicles' */
export function fill(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString());
}
