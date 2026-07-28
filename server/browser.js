// Drives Brave through the Chromium DevTools protocol. This is what lets the phone
// keep working as a remote once a provider takes over the screen: keystrokes are
// dispatched straight into the page, so no macOS Accessibility grant is needed.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { ROOT, config } from './config.js';

const PROFILE_DIR = join(ROOT, 'data', 'brave-profile');
const ENDPOINT = `http://127.0.0.1:${config.cdpPort}`;

let child = null;
const sockets = new Map();
let nextId = 1;

const KEYS = {
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  fullscreen: { key: 'f', code: 'KeyF', vk: 70, text: 'f' },
  mute: { key: 'm', code: 'KeyM', vk: 77, text: 'm' },
  subtitles: { key: 'c', code: 'KeyC', vk: 67, text: 'c' }
};

async function api(path, method = 'GET') {
  const res = await fetch(ENDPOINT + path, { method, signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function ready(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await api('/json/version');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

export function running() {
  return child !== null && child.exitCode === null;
}

export async function launch({ url, bounds }) {
  if (running()) return;
  mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,BraveRewards,BraveWallet,BraveVPN',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
    '--no-default-browser-check',
    '--kiosk',
    url
  ];

  if (bounds) {
    args.push(`--window-position=${Math.round(bounds.x)},${Math.round(bounds.y)}`);
    args.push(`--window-size=${Math.round(bounds.w)},${Math.round(bounds.h)}`);
  }

  child = spawn(config.bravePath, args, { detached: false, stdio: 'ignore' });
  child.on('exit', () => { child = null; });

  const ok = await ready();
  if (!ok) console.warn('[browser] Brave did not expose its debugging port');
  return ok;
}

export function quit() {
  for (const socket of sockets.values()) socket.close();
  sockets.clear();
  if (child) {
    child.kill('SIGTERM');
    child = null;
  }
}

export async function targets() {
  const list = await api('/json/list');
  return Array.isArray(list) ? list.filter((t) => t.type === 'page') : [];
}

export async function mainTarget() {
  const pages = await targets().catch(() => []);
  return pages[0] || null;
}

export async function goTo(url) {
  const target = await mainTarget();
  if (!target) return false;
  const socket = await connect(target);
  await send(socket, 'Page.navigate', { url });
  return true;
}

export async function openTab(url) {
  const created = await api(`/json/new?${encodeURIComponent(url)}`, 'PUT');
  if (created && created.id) return created;
  const fallback = await api(`/json/new?${encodeURIComponent(url)}`);
  return fallback;
}

export async function activate(targetId) {
  await api(`/json/activate/${targetId}`);
}

export async function closeTab(targetId) {
  const socket = sockets.get(targetId);
  if (socket) {
    socket.close();
    sockets.delete(targetId);
  }
  await api(`/json/close/${targetId}`);
}

function connect(target) {
  const existing = sockets.get(target.id);
  if (existing && existing.readyState === WebSocket.OPEN) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    const timer = setTimeout(() => reject(new Error('cdp connect timeout')), 5000);
    socket.on('open', () => {
      clearTimeout(timer);
      sockets.set(target.id, socket);
      resolve(socket);
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('close', () => sockets.delete(target.id));
  });
}

function send(socket, method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.id !== id) return;
      socket.off('message', onMessage);
      resolve(msg.result);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      socket.off('message', onMessage);
      resolve(undefined);
    }, 4000);
  });
}

export async function pressKey(target, name) {
  const spec = KEYS[name];
  if (!spec) return false;
  const socket = await connect(target);

  const base = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk
  };

  await send(socket, 'Input.dispatchKeyEvent', {
    ...base,
    type: spec.text ? 'keyDown' : 'rawKeyDown',
    text: spec.text || ''
  });
  await send(socket, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  return true;
}

export async function typeText(target, text) {
  if (!text) return false;
  const socket = await connect(target);
  await send(socket, 'Input.insertText', { text });
  return true;
}

export async function screenshot(target) {
  const socket = await connect(target);
  const result = await send(socket, 'Page.captureScreenshot', { format: 'png' });
  return result?.data ? Buffer.from(result.data, 'base64') : null;
}

export async function evaluate(target, expression) {
  const socket = await connect(target);
  const result = await send(socket, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result?.result?.value;
}
