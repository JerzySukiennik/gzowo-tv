// Thin wrapper around tools/display.swift. macOS silently re-enables mirroring on
// every HDMI replug and hides the true 1080p mode behind a HiDPI entry that keeps
// the link at 30 Hz, so the mode is enforced on every start rather than trusted.

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ROOT, config } from './config.js';

const run = promisify(execFile);
const SCRIPT = join(ROOT, 'tools', 'display.swift');

async function swift(args) {
  try {
    const { stdout } = await run('swift', [SCRIPT, ...args], { timeout: 20000 });
    return JSON.parse(stdout);
  } catch (err) {
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {}
    }
    return { ok: false, error: err.message };
  }
}

export function info() {
  return swift(['info']);
}

export async function apply() {
  const result = await swift([
    'apply',
    String(config.displayWidth),
    String(config.displayHeight),
    String(config.maxRefresh)
  ]);

  if (!result.ok) {
    if (result.error === 'no-external-display') {
      console.log('[display] no TV connected — running on the built-in screen');
    } else {
      console.warn('[display] could not set the mode:', result.error);
    }
    return result;
  }

  const { width, height, refresh } = result.applied;
  console.log(`[display] TV set to ${width}x${height} @ ${Math.round(refresh)} Hz` +
    (result.unmirrored ? ' (mirroring turned off)' : ''));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] === 'apply' ? apply : info;
  console.log(JSON.stringify(await command(), null, 2));
}
