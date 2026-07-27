// Per-profile history and watchlist, kept as plain JSON on disk. What a provider
// does after the hand-off is invisible to us, so history records what was opened,
// never how much of it was watched.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

const DIR = join(ROOT, 'data');
const FILE = join(DIR, 'store.json');
mkdirSync(DIR, { recursive: true });

const PROFILES = [
  { id: 'jurek', name: 'Jurek' },
  { id: 'janek', name: 'Janek' },
  { id: 'rysio', name: 'Rysio' },
  { id: 'wszyscy', name: 'Wszyscy' }
];

const empty = () => ({
  profiles: PROFILES,
  active: 'jurek',
  history: Object.fromEntries(PROFILES.map((p) => [p.id, []])),
  watchlist: Object.fromEntries(PROFILES.map((p) => [p.id, []]))
});

let state = load();

function load() {
  if (!existsSync(FILE)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    const base = empty();
    return {
      ...base,
      ...parsed,
      profiles: PROFILES,
      history: { ...base.history, ...(parsed.history || {}) },
      watchlist: { ...base.watchlist, ...(parsed.watchlist || {}) }
    };
  } catch {
    return empty();
  }
}

function persist() {
  try {
    writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[store] write failed:', err.message);
  }
}

export function profiles() {
  return { profiles: state.profiles, active: state.active };
}

export function setActive(id) {
  if (state.profiles.some((p) => p.id === id)) {
    state.active = id;
    persist();
  }
  return state.active;
}

export function history(profile = state.active) {
  return state.history[profile] || [];
}

export function recordOpen(item, provider, profile = state.active) {
  const list = state.history[profile] || (state.history[profile] = []);
  const entry = {
    id: item.id,
    type: item.type,
    title: item.title,
    poster: item.poster,
    backdrop: item.backdrop || null,
    provider,
    at: Date.now()
  };
  const rest = list.filter((e) => !(e.id === item.id && e.type === item.type));
  state.history[profile] = [entry, ...rest].slice(0, 40);
  persist();
  return state.history[profile];
}

export function watchlist(profile = state.active) {
  return state.watchlist[profile] || [];
}

export function toggleWatchlist(item, profile = state.active) {
  const list = state.watchlist[profile] || (state.watchlist[profile] = []);
  const idx = list.findIndex((e) => e.id === item.id && e.type === item.type);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.unshift({
      id: item.id,
      type: item.type,
      title: item.title,
      poster: item.poster,
      backdrop: item.backdrop || null,
      at: Date.now()
    });
  }
  persist();
  return { list: state.watchlist[profile], added: idx < 0 };
}

export function inWatchlist(item, profile = state.active) {
  return (state.watchlist[profile] || []).some((e) => e.id === item.id && e.type === item.type);
}
