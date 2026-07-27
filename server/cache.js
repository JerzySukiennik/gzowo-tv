// Disk-backed cache. Keeps the catalogue alive when the internet drops and keeps
// the YouTube quota (100 units per search, 10k per day) from being burned by scrolling.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './config.js';

const DIR = join(ROOT, 'cache');
mkdirSync(DIR, { recursive: true });

const memory = new Map();

function pathFor(key) {
  return join(DIR, createHash('sha1').update(key).digest('hex') + '.json');
}

export function read(key, maxAgeMs) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;

  const file = pathFor(key);
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    memory.set(key, raw);
    if (Date.now() - raw.at < maxAgeMs) return raw.value;
  } catch {
    return undefined;
  }
  return undefined;
}

export function readStale(key) {
  const hit = memory.get(key);
  if (hit) return hit.value;
  const file = pathFor(key);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).value;
  } catch {
    return undefined;
  }
}

export function write(key, value) {
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  try {
    writeFileSync(pathFor(key), JSON.stringify(entry));
  } catch (err) {
    console.warn('[cache] write failed:', err.message);
  }
  return value;
}

export function sweep(maxAgeMs = 1000 * 60 * 60 * 24 * 30) {
  let removed = 0;
  for (const name of readdirSync(DIR)) {
    const file = join(DIR, name);
    try {
      if (Date.now() - statSync(file).mtimeMs > maxAgeMs) {
        unlinkSync(file);
        removed++;
      }
    } catch {}
  }
  return removed;
}
