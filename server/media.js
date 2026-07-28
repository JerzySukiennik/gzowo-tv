// Gzowo Originals. Scans a folder of video files, pulls a poster frame and the
// duration out of each with ffmpeg, and serves them as a row. This is the only
// part of the catalogue that works with no internet at all.

import { readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { ROOT } from './config.js';

const run = promisify(execFile);

export const MEDIA_DIR = join(ROOT, 'media');
const THUMB_DIR = join(ROOT, 'cache', 'thumbs');

const VIDEO = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv']);
const SCAN_TTL = 30 * 1000;

mkdirSync(MEDIA_DIR, { recursive: true });
mkdirSync(THUMB_DIR, { recursive: true });

let cached = { at: 0, items: [] };

function idFor(path) {
  return createHash('sha1').update(path).digest('hex').slice(0, 16);
}

function titleFrom(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\d{4}[- ]\d{2}[- ]\d{2}\s*/, '')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function walk(dir, depth = 0) {
  if (depth > 3) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, depth + 1));
    else if (VIDEO.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function probeDuration(path) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path
    ], { timeout: 15000 });
    const value = Number(String(stdout).trim());
    return Number.isFinite(value) ? Math.round(value) : null;
  } catch {
    return null;
  }
}

async function makeThumb(path, id, duration) {
  const out = join(THUMB_DIR, `${id}.jpg`);
  if (existsSync(out)) return out;

  const at = duration ? Math.min(Math.max(duration * 0.12, 1), duration - 0.5) : 2;
  try {
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', String(at),
      '-i', path,
      '-frames:v', '1',
      '-vf', 'scale=854:-2',
      '-q:v', '4',
      out
    ], { timeout: 30000 });
    return existsSync(out) ? out : null;
  } catch (err) {
    console.warn('[media] thumbnail failed for', basename(path), err.message);
    return null;
  }
}

export async function scan(force = false) {
  if (!force && Date.now() - cached.at < SCAN_TTL) return cached.items;

  const files = walk(MEDIA_DIR);
  const items = [];

  for (const path of files) {
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size < 1024) continue;

    const id = idFor(path);
    const duration = await probeDuration(path);
    const thumb = await makeThumb(path, id, duration);

    items.push({
      kind: 'original',
      id,
      path,
      title: titleFrom(basename(path)),
      duration,
      thumb: thumb ? `/media-thumb/${id}.jpg` : null,
      src: `/media-file/${id}`
    });
  }

  items.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  cached = { at: Date.now(), items };
  return items;
}

export function thumbPath(id) {
  const file = join(THUMB_DIR, `${id.replace(/[^a-f0-9]/gi, '')}.jpg`);
  return existsSync(file) ? file : null;
}

export function filePath(id) {
  const match = cached.items.find((item) => item.id === id);
  return match && existsSync(match.path) ? match.path : null;
}

export async function row() {
  const items = await scan();
  if (!items.length) return null;
  return { key: 'originals', title: 'Gzowo Originals', wide: true, items };
}
