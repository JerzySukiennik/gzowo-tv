// Loads .env into a frozen config object. No dependency on dotenv.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...readEnv(), ...process.env };

export const config = Object.freeze({
  port: Number(env.PORT || 7420),
  tmdb: {
    key: env.TMDB_API_KEY || '',
    language: env.TMDB_LANGUAGE || 'pl-PL',
    region: env.TMDB_REGION || 'PL'
  },
  youtubeKey: env.YOUTUBE_API_KEY || '',
  displayWidth: Number(env.DISPLAY_WIDTH || 1920),
  displayHeight: Number(env.DISPLAY_HEIGHT || 1080),
  maxRefresh: Number(env.MAX_REFRESH || 240),
  cdpPort: Number(env.CDP_PORT || 9222),
  bravePath: env.BRAVE_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
});

if (!config.tmdb.key) {
  console.error('[config] TMDB_API_KEY is missing — the catalogue cannot load.');
}
