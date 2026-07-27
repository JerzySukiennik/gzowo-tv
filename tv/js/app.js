// GZOWO television client. Owns focus, the catalogue, the detail screen and the
// hand-off to a provider. Every input arrives from the phone over the socket.

import { play as playBoot } from './boot.js';
import { dominant } from './palette.js';

const $ = (id) => document.getElementById(id);
const body = document.body;

function reveal(el, className = 'shown') {
  el.hidden = false;
  void el.offsetHeight;
  el.classList.add(className);
}

const IDLE_MS = 5 * 60 * 1000;
const TRAILER_DELAY = 2600;

const state = {
  screen: 'boot',
  home: null,
  sections: [],
  pos: { s: 0, i: 0 },
  detail: null,
  search: { query: '', items: [] },
  idleTimer: null,
  trailerTimer: null
};

let socket = null;

/* ---------- transport ---------- */

function connect() {
  socket = new WebSocket(`ws://${location.host}/ws?role=tv`);
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handle(message);
  });
  socket.addEventListener('close', () => setTimeout(connect, 1200));
}

function tell(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: options?.body ? { 'content-type': 'application/json' } : undefined
  });
  return res.json();
}

/* ---------- input ---------- */

function handle(message) {
  if (message.type === 'returned') {
    showHome();
    return;
  }

  if (message.type !== 'key' && message.type !== 'text' && message.type !== 'wake') {
    return;
  }

  wake();

  if (message.type === 'wake') return;

  if (message.type === 'text') {
    if (state.screen !== 'search') openSearch();
    runSearch(message.value);
    return;
  }

  route(message.name);
}

function route(key) {
  if (state.screen === 'detail') return detailKey(key);
  if (state.screen === 'search') return searchKey(key);
  return homeKey(key);
}

/* ---------- idle ---------- */

function wake() {
  if (state.screen === 'idle') {
    body.dataset.screen = state.screen = 'home';
    tell({ type: 'mode', mode: 'ui' });
  }
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(sleep, IDLE_MS);
}

function sleep() {
  stopTrailers();
  body.dataset.screen = state.screen = 'idle';
}

/* ---------- focus ---------- */

function sectionAt(index) {
  return state.sections[index];
}

function current() {
  const section = sectionAt(state.pos.s);
  return section?.items[state.pos.i];
}

function paint() {
  for (const section of state.sections) {
    const active = section === sectionAt(state.pos.s);
    section.el.dataset.focus = active ? 'on' : 'off';
    section.items.forEach((item, i) => {
      item.el.dataset.focus = active && i === state.pos.i ? 'on' : 'off';
    });
  }
  scrollIntoPlace();
  tint();
}

function scrollIntoPlace() {
  const section = sectionAt(state.pos.s);
  if (!section) return;

  if (section.track) {
    const card = section.items[state.pos.i]?.el;
    if (card) {
      const step = card.offsetWidth + 0.85 * 18;
      const shift = Math.max(0, (state.pos.i - 1) * step);
      section.track.style.transform = `translate3d(${-shift}px,0,0)`;
    }
  }

  const home = $('home');
  if (state.pos.s === 0) {
    home.style.transform = 'translate3d(0,0,0)';
    return;
  }
  const top = section.el.offsetTop;
  const offset = Math.max(0, top - window.innerHeight * 0.4);
  home.style.transform = `translate3d(0,${-offset}px,0)`;
}

async function tint() {
  const item = current();
  const src = item?.data?.poster
    ? `/img/w185${item.data.poster}`
    : state.home?.hero?.backdrop
      ? `/img/w300${state.home.hero.backdrop}`
      : null;
  const rgb = await dominant(src);
  document.documentElement.style.setProperty('--tint', rgb.join(', '));
}

function move(dr, dc) {
  const sections = state.sections;
  if (!sections.length) return;

  if (dr) {
    const next = Math.min(sections.length - 1, Math.max(0, state.pos.s + dr));
    if (next === state.pos.s) return;
    state.pos.s = next;
    state.pos.i = Math.min(state.pos.i, sections[next].items.length - 1);
    if (next === 0) state.pos.i = 0;
    restartTrailer();
  }

  if (dc) {
    const section = sectionAt(state.pos.s);
    const next = Math.min(section.items.length - 1, Math.max(0, state.pos.i + dc));
    if (next === state.pos.i) return;
    state.pos.i = next;
  }

  paint();
}

/* ---------- home ---------- */

function homeKey(key) {
  switch (key) {
    case 'up': return move(-1, 0);
    case 'down': return move(1, 0);
    case 'left': return move(0, -1);
    case 'right': return move(0, 1);
    case 'enter': return activate();
    case 'search': return openSearch();
    case 'escape': return move(-state.pos.s, 0);
    default: return undefined;
  }
}

function activate() {
  const item = current();
  if (!item) return;
  if (item.action) return item.action();
  if (item.data) openDetail(item.data);
}

/* ---------- rendering ---------- */

function card(item) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.focus = 'off';

  if (item.poster) {
    const img = new Image();
    img.decoding = 'async';
    img.alt = item.title;
    img.src = `/img/w342${item.poster}`;
    img.addEventListener('load', () => img.classList.add('ready'));
    el.append(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'fallback';
    fallback.textContent = item.title;
    el.append(fallback);
  }

  if (item.provider) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item.provider;
    el.append(chip);
  }

  return el;
}

function actionButton(label, badge, handler) {
  const el = document.createElement('button');
  el.className = 'action';
  el.dataset.focus = 'off';
  el.append(document.createTextNode(label));
  if (badge) {
    const tag = document.createElement('span');
    tag.className = 'badge';
    tag.textContent = badge;
    el.append(tag);
  }
  return { el, action: handler };
}

function offerLabel(offer) {
  if (offer === 'flatrate') return 'W abonamencie';
  if (offer === 'rent') return 'Wypożycz';
  return 'Kup';
}

function providerActions(title, container) {
  const items = [];
  const list = title.providers || [];

  for (const provider of list) {
    items.push(actionButton(
      provider.kind === 'native' ? provider.name : `Oglądaj na ${provider.name}`,
      offerLabel(provider.offer),
      () => launch(provider.key, title)
    ));
  }

  items.push(actionButton(title.saved ? 'W liście' : 'Do obejrzenia', null, () => saveToggle(title)));

  if (!list.length) {
    const none = actionButton('Niedostępne w waszych serwisach', null, () => {});
    none.el.dataset.muted = 'on';
    items.push(none);
  }

  container.replaceChildren(...items.map((i) => i.el));
  return items;
}

function meta(item, container) {
  const bits = [];
  if (item.year) bits.push(String(item.year));
  if (item.runtime) bits.push(`${item.runtime} min`);
  if (item.seasons?.length) bits.push(`${item.seasons.length} ${item.seasons.length === 1 ? 'sezon' : 'sezony'}`);
  if (item.rating) bits.push(`★ ${item.rating}`);
  if (item.genres?.length) bits.push(item.genres.slice(0, 3).join(' · '));

  container.replaceChildren();
  bits.forEach((bit, i) => {
    if (i) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      container.append(dot);
    }
    const span = document.createElement('span');
    span.textContent = bit;
    container.append(span);
  });
}

function buildHome(payload) {
  state.home = payload;
  state.sections = [];

  const hero = payload.hero;
  if (hero) {
    $('hero-eyebrow').textContent = hero.type === 'tv' ? 'Serial' : 'Film';
    $('hero-title').textContent = hero.title;
    $('hero-overview').textContent = hero.overview || '';
    meta(hero, $('hero-meta'));

    const backdrop = $('hero-backdrop');
    backdrop.classList.remove('ready');
    if (hero.backdrop) {
      backdrop.src = `/img/w1280${hero.backdrop}`;
      backdrop.addEventListener('load', () => backdrop.classList.add('ready'), { once: true });
    }

    const actions = providerActions(hero, $('hero-actions'));
    state.sections.push({ el: $('hero'), items: actions, track: null });
  }

  const rowsEl = $('rows');
  rowsEl.replaceChildren();

  for (const row of payload.rows) {
    const section = document.createElement('section');
    section.className = 'row';
    section.dataset.focus = 'off';

    const heading = document.createElement('h2');
    heading.className = 'row-title';
    heading.textContent = row.title;

    const track = document.createElement('div');
    track.className = 'track';

    const items = row.items.map((entry) => {
      const el = card(entry);
      track.append(el);
      return { el, data: entry };
    });

    section.append(heading, track);
    rowsEl.append(section);
    state.sections.push({ el: section, items, track });
  }

  $('offline').hidden = payload.online;
  state.pos = { s: 0, i: 0 };
  paint();
  restartTrailer();
}

/* ---------- trailers ---------- */

function stopTrailers() {
  clearTimeout(state.trailerTimer);
  for (const id of ['hero-trailer', 'detail-trailer']) {
    const host = $(id);
    host.classList.remove('playing');
    host.replaceChildren();
  }
}

function restartTrailer() {
  stopTrailers();
  if (state.pos.s !== 0) return;
  const key = state.home?.hero?.trailer;
  if (!key) return;
  state.trailerTimer = setTimeout(() => mountTrailer($('hero-trailer'), key), TRAILER_DELAY);
}

function mountTrailer(host, key) {
  const frame = document.createElement('iframe');
  frame.allow = 'autoplay; encrypted-media';
  frame.src = `https://www.youtube-nocookie.com/embed/${key}` +
    `?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${key}` +
    `&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  host.replaceChildren(frame);
  void host.offsetHeight;
  host.classList.add('playing');
  rampVolume(frame);
}

function rampVolume(frame) {
  const send = (func, args) => frame.contentWindow?.postMessage(
    JSON.stringify({ event: 'command', func, args: args || [] }), '*'
  );

  setTimeout(() => {
    send('unMute');
    let level = 0;
    const step = setInterval(() => {
      level += 6;
      send('setVolume', [level]);
      if (level >= 48) clearInterval(step);
    }, 130);
  }, 1100);
}

/* ---------- detail ---------- */

async function openDetail(entry) {
  stopTrailers();
  const data = await api(`/api/detail/${entry.type}/${entry.id}`).catch(() => null);
  if (!data || data.error) return toast('Nie udało się pobrać szczegółów');

  state.detail = data;
  $('detail-eyebrow').textContent = data.type === 'tv' ? 'Serial' : 'Film';
  $('detail-title').textContent = data.title;
  $('detail-overview').textContent = data.overview || '';
  meta(data, $('detail-meta'));

  const backdrop = $('detail-backdrop');
  backdrop.classList.remove('ready');
  if (data.backdrop) {
    backdrop.src = `/img/w1280${data.backdrop}`;
    backdrop.addEventListener('load', () => backdrop.classList.add('ready'), { once: true });
  }

  const cast = $('detail-cast');
  cast.replaceChildren(...(data.cast || []).slice(0, 6).map((person) => {
    const span = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = person.name;
    span.append(name, document.createTextNode(person.character || ''));
    return span;
  }));

  const actions = providerActions(data, $('detail-actions'));
  state.detailActions = actions;
  state.detailIndex = 0;
  paintDetail();

  reveal($('detail'));
  body.dataset.screen = state.screen = 'detail';

  dominant(data.backdrop ? `/img/w300${data.backdrop}` : null)
    .then((rgb) => document.documentElement.style.setProperty('--tint', rgb.join(', ')));

  if (data.trailer) {
    state.trailerTimer = setTimeout(() => mountTrailer($('detail-trailer'), data.trailer), TRAILER_DELAY);
  }
}

function paintDetail() {
  state.detailActions?.forEach((item, i) => {
    item.el.dataset.focus = i === state.detailIndex ? 'on' : 'off';
  });
}

function detailKey(key) {
  const actions = state.detailActions || [];
  if (key === 'left') {
    state.detailIndex = Math.max(0, state.detailIndex - 1);
    return paintDetail();
  }
  if (key === 'right') {
    state.detailIndex = Math.min(actions.length - 1, state.detailIndex + 1);
    return paintDetail();
  }
  if (key === 'enter') return actions[state.detailIndex]?.action();
  if (key === 'escape' || key === 'back') return closeDetail();
  return undefined;
}

function closeDetail() {
  stopTrailers();
  $('detail').classList.remove('shown');
  setTimeout(() => { $('detail').hidden = true; }, 420);
  body.dataset.screen = state.screen = 'home';
  paint();
  restartTrailer();
}

/* ---------- search ---------- */

function openSearch() {
  stopTrailers();
  reveal($('search'));
  body.dataset.screen = state.screen = 'search';
  state.search = { query: '', items: [] };
  $('search-query').textContent = 'Type on your phone';
  $('search-results').replaceChildren();
}

function closeSearch() {
  $('search').classList.remove('shown');
  setTimeout(() => { $('search').hidden = true; }, 320);
  body.dataset.screen = state.screen = 'home';
  paint();
  restartTrailer();
}

let searchTimer = null;

function runSearch(value) {
  state.search.query = value;
  $('search-query').textContent = value || 'Type on your phone';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!value || value.trim().length < 2) {
      $('search-results').replaceChildren();
      state.sections = [];
      return;
    }
    const { results } = await api(`/api/search?q=${encodeURIComponent(value)}`).catch(() => ({ results: [] }));
    state.search.items = results;

    const grid = $('search-results');
    const items = results.map((entry) => {
      const first = entry.providers?.[0];
      const el = card({ ...entry, provider: first?.name });
      grid.append(el);
      return { el, data: entry };
    });
    grid.replaceChildren(...items.map((i) => i.el));

    state.searchItems = items;
    state.searchIndex = 0;
    paintSearch();
  }, 260);
}

function paintSearch() {
  state.searchItems?.forEach((item, i) => {
    item.el.dataset.focus = i === state.searchIndex ? 'on' : 'off';
  });
}

function searchKey(key) {
  const items = state.searchItems || [];
  const columns = 7;
  if (!items.length && (key === 'escape' || key === 'back')) return closeSearch();

  if (key === 'left') state.searchIndex = Math.max(0, state.searchIndex - 1);
  else if (key === 'right') state.searchIndex = Math.min(items.length - 1, state.searchIndex + 1);
  else if (key === 'up') state.searchIndex = Math.max(0, state.searchIndex - columns);
  else if (key === 'down') state.searchIndex = Math.min(items.length - 1, state.searchIndex + columns);
  else if (key === 'enter') return openDetail(items[state.searchIndex].data);
  else if (key === 'escape' || key === 'back') return closeSearch();
  else return undefined;

  return paintSearch();
}

/* ---------- provider hand-off ---------- */

async function launch(providerKey, title) {
  const result = await api('/api/open', {
    method: 'POST',
    body: JSON.stringify({ providerKey, item: title })
  }).catch(() => ({ ok: false }));

  if (!result.ok) {
    return toast(result.error === 'brave-not-running'
      ? 'Uruchom system przez ikonę GZOWO, żeby otwierać serwisy'
      : 'Nie udało się otworzyć serwisu');
  }

  stopTrailers();
  toast(result.kind === 'native' ? 'Otwieram aplikację TV' : 'Przechodzę do serwisu');
}

async function saveToggle(title) {
  const result = await api('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify({ item: title })
  }).catch(() => null);
  if (!result) return;
  toast(result.added ? 'Dodano do listy' : 'Usunięto z listy');
  title.saved = result.added;
  if (state.screen === 'detail') {
    state.detailActions = providerActions(title, $('detail-actions'));
    paintDetail();
  }
}

/* ---------- chrome ---------- */

let toastTimer = null;

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  reveal(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('shown');
    setTimeout(() => { el.hidden = true; }, 300);
  }, 2400);
}

function showHome() {
  if (state.screen === 'detail') closeDetail();
  if (state.screen === 'search') closeSearch();
  body.dataset.screen = state.screen = 'home';
  state.pos = { s: 0, i: 0 };
  paint();
  restartTrailer();
}

/* ---------- start ---------- */

async function main() {
  connect();

  const boot = playBoot($('boot'));
  const payload = await api('/api/home').catch(() => null);

  if (!payload || payload.error) {
    await boot;
    $('pairing').hidden = false;
    $('pair-url').textContent = 'Serwer nie odpowiada';
    body.dataset.screen = state.screen = 'error';
    return;
  }

  $('pair-url').textContent = payload.remoteUrl;
  $('home').hidden = false;
  buildHome(payload);

  await boot;
  body.dataset.screen = state.screen = 'home';
  wake();

  window.addEventListener('keydown', (event) => {
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      Enter: 'enter', Escape: 'escape', Backspace: 'back'
    };
    const name = map[event.key];
    if (!name) return;
    event.preventDefault();
    wake();
    route(name);
  });
}

main();
