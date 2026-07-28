// GZOWO server: serves the TV interface and the phone remote, proxies TMDB, and
// routes remote input either into the TV interface or straight into whichever
// provider tab currently owns the screen.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { ROOT, config } from './config.js';
import * as tmdb from './tmdb.js';
import * as store from './store.js';
import * as providers from './providers.js';
import * as browser from './browser.js';
import * as display from './display.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2'
};

const ROWS = [
  { key: 'trending', title: 'Trending Now' },
  { key: 'new', title: 'New This Season' },
  { key: 'popular-movies', title: 'Popular Films' },
  { key: 'popular-tv', title: 'Popular Series' },
  { key: 'space', title: 'Space & Sci-Fi' },
  { key: 'docs', title: 'Documentaries' },
  { key: 'family', title: 'For Everyone' }
];

const session = {
  mode: 'ui',
  provider: null,
  targetId: null,
  title: null
};

const clients = { tv: new Set(), remote: new Set() };

function localAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

const REMOTE_URL = () => `http://${localAddress()}:${config.port}/remote/`;

function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function serveStatic(req, res, url) {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache'
  });
  createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function homePayload() {
  const [hero, ...lists] = await Promise.all([
    tmdb.heroPick().catch(() => null),
    ...ROWS.map((r) => tmdb.row(r.key).catch(() => []))
  ]);

  const rows = ROWS.map((r, i) => ({ ...r, items: lists[i] })).filter((r) => r.items.length);
  const profile = store.profiles();

  const personal = [];
  const watch = store.watchlist();
  const seen = store.history();
  if (watch.length) personal.push({ key: 'watchlist', title: 'Do obejrzenia', items: watch });
  if (seen.length) personal.push({ key: 'history', title: 'Ostatnio oglądane', items: seen });

  return {
    hero,
    rows: [...personal, ...rows],
    providers: providers.all(),
    profile,
    remoteUrl: REMOTE_URL(),
    online: rows.length > 0
  };
}

function broadcast(role, message) {
  const payload = JSON.stringify(message);
  for (const socket of clients[role]) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function pushState() {
  broadcast('remote', {
    type: 'state',
    mode: session.mode,
    provider: session.provider,
    title: session.title,
    tvConnected: clients.tv.size > 0
  });
}

async function activeProviderTarget() {
  return browser.mainTarget().catch(() => null);
}

async function handleRemoteInput(message) {
  if (session.mode === 'provider') {
    const target = await activeProviderTarget();
    if (!target) {
      session.mode = 'ui';
      session.provider = null;
      session.targetId = null;
      pushState();
      return;
    }
    if (message.type === 'key') await browser.pressKey(target, message.name);
    else if (message.type === 'text') await browser.typeText(target, message.value);
    return;
  }
  broadcast('tv', message);
}

async function openProvider({ providerKey, item }) {
  const url = providers.launchUrl(providerKey, item?.title);
  const provider = providers.byKey(providerKey);

  if (!provider) return { ok: false, error: 'unknown-provider' };

  if (provider.kind === 'native') {
    const { spawn } = await import('node:child_process');
    spawn('open', ['-a', 'TV'], { stdio: 'ignore', detached: true }).unref();
    if (item) store.recordOpen(item, providerKey);
    session.mode = 'native';
    session.provider = providerKey;
    session.title = item?.title || provider.name;
    pushState();
    return { ok: true, kind: 'native' };
  }

  if (!browser.running()) return { ok: false, error: 'brave-not-running' };

  const went = await browser.goTo(url).catch(() => false);
  if (!went) return { ok: false, error: 'navigation-failed' };

  session.mode = 'provider';
  session.provider = providerKey;
  session.targetId = null;
  session.title = item?.title || provider.name;
  if (item) store.recordOpen(item, providerKey);
  pushState();
  return { ok: true, kind: 'browser' };
}

async function returnHome() {
  if (session.mode === 'provider') {
    await browser.goTo(`http://localhost:${config.port}/tv/?resume=1`).catch(() => {});
  }
  session.mode = 'ui';
  session.provider = null;
  session.targetId = null;
  session.title = null;
  pushState();
  broadcast('tv', { type: 'returned' });
  return { ok: true };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/') {
    res.writeHead(302, { location: '/tv/' });
    return res.end();
  }

  if (url.pathname.startsWith('/img/')) {
    const [, , size, ...rest] = url.pathname.split('/');
    try {
      const buf = await tmdb.image(size, '/' + rest.join('/'));
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800' });
      return res.end(buf);
    } catch {
      res.writeHead(404);
      return res.end();
    }
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      if (url.pathname === '/api/home') return json(res, await homePayload());

      if (url.pathname === '/api/search') {
        return json(res, { results: await tmdb.search(url.searchParams.get('q') || '') });
      }

      if (url.pathname.startsWith('/api/detail/')) {
        const [, , , type, id] = url.pathname.split('/');
        const data = await tmdb.detail(type, id);
        return json(res, { ...data, saved: store.inWatchlist(data) });
      }

      if (url.pathname === '/api/open' && req.method === 'POST') {
        const body = await readBody(req);
        return json(res, await openProvider(body));
      }

      if (url.pathname === '/api/home-return' && req.method === 'POST') {
        return json(res, await returnHome());
      }

      if (url.pathname === '/api/profile' && req.method === 'POST') {
        const body = await readBody(req);
        return json(res, { active: store.setActive(body.id) });
      }

      if (url.pathname === '/api/watchlist' && req.method === 'POST') {
        const body = await readBody(req);
        return json(res, store.toggleWatchlist(body.item));
      }

      if (url.pathname === '/api/status') {
        return json(res, {
          session,
          remoteUrl: REMOTE_URL(),
          tvConnected: clients.tv.size > 0,
          remotes: clients.remote.size,
          brave: browser.running(),
          display: await display.info()
        });
      }

      return json(res, { error: 'unknown endpoint' }, 404);
    } catch (err) {
      console.error('[api]', url.pathname, err.message);
      return json(res, { error: err.message }, 500);
    }
  }

  return serveStatic(req, res, url);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost');
  const role = url.searchParams.get('role') === 'tv' ? 'tv' : 'remote';
  clients[role].add(socket);

  if (role === 'remote') {
    socket.send(JSON.stringify({
      type: 'state',
      mode: session.mode,
      provider: session.provider,
      title: session.title,
      tvConnected: clients.tv.size > 0
    }));
  }
  if (role === 'tv') pushState();

  socket.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (role === 'remote') {
      if (message.type === 'home') return void (await returnHome());
      return void (await handleRemoteInput(message));
    }

    if (message.type === 'mode') {
      session.mode = message.mode;
      pushState();
    }
  });

  socket.on('close', () => {
    clients[role].delete(socket);
    pushState();
  });
});

async function main() {
  await display.apply();

  server.listen(config.port, () => {
    console.log(`\n  GZOWO`);
    console.log(`  TV      http://localhost:${config.port}/tv/`);
    console.log(`  Remote  ${REMOTE_URL()}\n`);
  });

  if (process.argv.includes('--launch')) {
    const info = await display.info();
    await browser.launch({
      url: `http://localhost:${config.port}/tv/`,
      bounds: info.ok ? info.bounds : null
    });
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    browser.quit();
    process.exit(0);
  });
}

main();
