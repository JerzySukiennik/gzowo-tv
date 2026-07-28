// Opens every provider's sign-in page in the kiosk browser profile, windowed and
// with normal chrome. Sessions live in that profile, so this is a one-off: after
// signing in here, the kiosk stays signed in across restarts.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config } from './config.js';

const PROFILE_DIR = join(ROOT, 'data', 'brave-profile');

const SIGN_IN = [
  ['Netflix', 'https://www.netflix.com/login'],
  ['HBO Max', 'https://auth.max.com/login'],
  ['Disney+', 'https://www.disneyplus.com/pl-pl/login'],
  ['Prime Video', 'https://www.primevideo.com/auth/login'],
  ['Apple TV+', 'https://tv.apple.com/pl']
];

mkdirSync(PROFILE_DIR, { recursive: true });

spawn(config.bravePath, [
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1400,900',
  ...SIGN_IN.map(([, url]) => url)
], { detached: true, stdio: 'ignore' }).unref();

console.log('\n  Signing in to the Gzowo TV browser profile\n');
for (const [name] of SIGN_IN) console.log(`  · ${name}`);
console.log(`
  One tab per service has opened. Sign in to each, then close the window.
  These sessions are stored in the Gzowo TV profile and survive restarts, so this
  is a one-off — your everyday Brave is untouched.

  If a service refuses to play video, open brave://settings/extensions in this
  same window and switch on "Widevine", then reload.
`);
