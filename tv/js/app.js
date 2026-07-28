// Gzowo TV television client. Owns focus, the catalogue, the detail screen and the
// hand-off to a provider. Every input arrives from the phone over the socket.

import { play as playBoot } from './boot.js';
import { dominant } from './palette.js';
import { unlock, tick, thud, press, back } from './sound.js';

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

  if (message.type === 'power') {
    unlock();
    return state.screen === 'standby' ? beginBoot() : goStandby();
  }

  if (message.type !== 'key' && message.type !== 'text' && message.type !== 'wake') {
    return;
  }

  unlock();

  // Nothing reaches the interface while the system is resting; the first thing
  // the remote sends is what starts it.
  if (state.screen === 'standby') return beginBoot();

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
  if (state.screen === 'player') return playerKey(key);
  if (state.screen === 'profiles') return profilesKey(key);
  if (state.screen === 'detail') return detailKey(key);
  if (state.screen === 'search') return searchKey(key);
  return homeKey(key);
}

/* ---------- standby ---------- */

async function beginBoot() {
  if (state.booting) return;
  state.booting = true;

  body.dataset.screen = state.screen = 'boot';
  tell({ type: 'mode', mode: 'ui' });

  const profile = state.home?.profile;
  const needsProfile = profile?.profiles?.length > 1;
  if (needsProfile) showProfiles(profile);

  await playBoot($('boot'));

  if (!needsProfile) body.dataset.screen = state.screen = 'home';
  state.booting = false;
  wake();
}

function goStandby() {
  stopTrailers();
  stopScreensaver();
  clearTimeout(state.idleTimer);

  if (player.ticker) clearInterval(player.ticker);
  for (const id of ['detail', 'search', 'profiles', 'player']) {
    const el = $(id);
    el.classList.remove('shown');
    el.hidden = true;
  }
  const video = $('video');
  video.pause();
  video.removeAttribute('src');
  if (player.yt?.destroy) player.yt.destroy();
  player.yt = null;
  $('frame').replaceChildren();

  state.pos = { s: 0, i: 0 };
  body.dataset.screen = state.screen = 'standby';
  tell({ type: 'mode', mode: 'standby' });
}

/* ---------- idle ---------- */

function wake() {
  if (state.screen === 'idle') {
    stopScreensaver();
    body.dataset.screen = state.screen = 'home';
    tell({ type: 'mode', mode: 'ui' });
  }
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(sleep, IDLE_MS);
}

function sleep() {
  if (state.screen === 'player') return;
  stopTrailers();
  body.dataset.screen = state.screen = 'idle';
  startScreensaver();
}

/* ---------- screensaver ---------- */

const SEGMENT = 40000;
const idle = { clips: [], index: 0, current: 'a', timer: null, clock: null };

async function loadClips() {
  if (idle.clips.length) return idle.clips;
  const data = await api('/api/screensaver').catch(() => null);
  idle.clips = data?.clips || [];
  return idle.clips;
}

function drawClock() {
  const now = new Date();
  $('idle-clock').textContent =
    `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function driftClock() {
  const el = $('idle-clock');
  el.style.left = `${8 + Math.floor(Math.random() * 60)}%`;
  el.style.top = `${18 + Math.floor(Math.random() * 62)}%`;
}

async function startScreensaver() {
  const clips = await loadClips();
  const stage = $('screensaver');

  drawClock();
  driftClock();
  clearInterval(idle.clock);
  idle.clock = setInterval(() => { drawClock(); driftClock(); }, 60000);

  reveal(stage);

  if (!clips.length) return;

  idle.index = Math.floor(Math.random() * clips.length);
  playClip();
}

function playClip() {
  const clips = idle.clips;
  if (!clips.length) return;

  const showing = $(`idle-${idle.current}`);
  const next = $(`idle-${idle.current === 'a' ? 'b' : 'a'}`);

  next.src = clips[idle.index % clips.length].src;

  // The clips run for minutes and only forty seconds of each is ever shown, so
  // start somewhere random rather than replaying the same opening every night.
  next.onloadedmetadata = () => {
    const span = (next.duration || 0) - SEGMENT / 1000 - 2;
    next.currentTime = span > 5 ? Math.random() * span : 0;
    next.play().catch(() => {});
  };

  next.classList.add('on');
  showing.classList.remove('on');
  idle.current = idle.current === 'a' ? 'b' : 'a';
  idle.index += 1;

  next.onended = () => playClip();
  clearTimeout(idle.timer);
  idle.timer = setTimeout(() => playClip(), SEGMENT);
}

function stopScreensaver() {
  clearInterval(idle.clock);
  clearTimeout(idle.timer);
  for (const id of ['idle-a', 'idle-b']) {
    const el = $(id);
    el.pause();
    el.classList.remove('on');
    el.removeAttribute('src');
    el.load();
  }
  const stage = $('screensaver');
  stage.classList.remove('shown');
  setTimeout(() => { stage.hidden = true; }, 900);
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

  tick(dr ? 1.25 : 1);
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
  if (!item.data) return;

  const kind = item.data.kind;
  if (kind === 'youtube' || kind === 'original') return openPlayer(item.data);
  return openDetail(item.data);
}

/* ---------- rendering ---------- */

function artFor(item) {
  if (item.kind === 'youtube' && item.thumb) return `/thumb?u=${encodeURIComponent(item.thumb)}`;
  if (item.kind === 'original') return item.thumb;
  return item.poster ? `/img/w342${item.poster}` : null;
}

function card(item) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.focus = 'off';

  const src = artFor(item);
  if (src) {
    const img = new Image();
    img.decoding = 'async';
    img.alt = item.title;
    img.src = src;
    img.addEventListener('load', () => img.classList.add('ready'));
    el.append(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'fallback';
    fallback.textContent = item.title;
    el.append(fallback);
  }

  if (item.kind === 'youtube' || item.kind === 'original') {
    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = item.title;
    el.append(caption);
  }

  if (item.live || item.upcoming) {
    const badge = document.createElement('span');
    badge.className = 'live';
    badge.dataset.state = item.live ? 'live' : 'upcoming';
    badge.textContent = item.live ? 'Na żywo' : 'Wkrótce';
    el.append(badge);
  }

  if (item.position && item.duration) {
    const bar = document.createElement('div');
    bar.className = 'progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, (item.position / item.duration) * 100)}%`;
    bar.append(fill);
    el.append(bar);
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
    track.className = row.wide ? 'track track--wide' : 'track';

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
  if (state.screen !== 'home') return;
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
  thud();
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

  buildDetailSections(data);

  reveal($('detail'));
  body.dataset.screen = state.screen = 'detail';

  dominant(data.backdrop ? `/img/w300${data.backdrop}` : null)
    .then((rgb) => document.documentElement.style.setProperty('--tint', rgb.join(', ')));

  if (data.trailer) {
    state.trailerTimer = setTimeout(() => mountTrailer($('detail-trailer'), data.trailer), TRAILER_DELAY);
  }
}

function buildDetailSections(data) {
  const sections = [{
    el: $('detail-actions'),
    items: providerActions(data, $('detail-actions'))
  }];

  const seasonHost = $('detail-seasons');
  const stripHost = $('detail-episodes');

  if (data.type === 'tv' && data.seasons?.length) {
    const items = data.seasons.map((s) =>
      actionButton(s.name, `${s.episodes} odc.`, () => loadSeason(data, s.number)));
    seasonHost.replaceChildren(...items.map((i) => i.el));
    seasonHost.hidden = false;
    sections.push({ el: seasonHost, items });
    sections.push({ el: stripHost, items: [], track: $('episode-track') });
    $('detail').classList.add('has-episodes');
    loadSeason(data, data.seasons[0].number, false);
  } else {
    seasonHost.hidden = true;
    stripHost.hidden = true;
    $('detail').classList.remove('has-episodes');
  }

  state.detailSections = sections;
  state.detailPos = { s: 0, i: 0 };
  paintDetail();
}

async function loadSeason(show, number, moveFocus = true) {
  const data = await api(`/api/season/${show.id}/${number}`).catch(() => null);
  const track = $('episode-track');
  const strip = $('detail-episodes');

  if (!data?.episodes?.length) {
    strip.hidden = true;
    return;
  }

  const items = data.episodes.map((episode) => {
    const el = document.createElement('div');
    el.className = 'episode';
    el.dataset.focus = 'off';

    if (episode.still) {
      const img = new Image();
      img.decoding = 'async';
      img.alt = episode.title;
      img.src = `/img/w300${episode.still}`;
      img.addEventListener('load', () => img.classList.add('ready'));
      el.append(img);
    }

    const label = document.createElement('div');
    label.className = 'label';
    const tag = document.createElement('b');
    tag.textContent = `S${String(number).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}` +
      (episode.runtime ? ` · ${episode.runtime} min` : '');
    label.append(tag, document.createTextNode(episode.title));
    el.append(label);

    track.append(el);
    return { el, action: () => playFirstProvider(show) };
  });

  track.replaceChildren(...items.map((i) => i.el));
  strip.hidden = false;

  const section = state.detailSections?.[2];
  if (section) {
    section.items = items;
    if (moveFocus) {
      state.detailPos = { s: 2, i: 0 };
      tick();
    }
    paintDetail();
  }
}

function playFirstProvider(title) {
  const first = (title.providers || []).find((p) => p.kind === 'browser');
  if (!first) return toast('Nie ma tego w waszych serwisach');
  return launch(first.key, title);
}

function paintDetail() {
  const sections = state.detailSections || [];
  sections.forEach((section, s) => {
    section.items.forEach((item, i) => {
      item.el.dataset.focus = s === state.detailPos.s && i === state.detailPos.i ? 'on' : 'off';
    });
  });

  const active = sections[state.detailPos.s];
  if (active?.track) {
    const card = active.items[state.detailPos.i]?.el;
    if (card) {
      const step = card.offsetWidth + 0.85 * 18;
      active.track.style.transform = `translate3d(${-Math.max(0, (state.detailPos.i - 1) * step)}px,0,0)`;
    }
  }
}

function detailKey(key) {
  const sections = state.detailSections || [];
  const pos = state.detailPos;

  if (key === 'escape' || key === 'back') return closeDetail();

  if (key === 'down' || key === 'up') {
    const step = key === 'down' ? 1 : -1;
    let next = pos.s;
    for (let i = pos.s + step; i >= 0 && i < sections.length; i += step) {
      if (sections[i].items.length) { next = i; break; }
    }
    if (next === pos.s) return undefined;
    state.detailPos = { s: next, i: 0 };
    tick(1.25);
    return paintDetail();
  }

  const items = sections[pos.s]?.items || [];
  if (key === 'left') state.detailPos.i = Math.max(0, pos.i - 1);
  else if (key === 'right') state.detailPos.i = Math.min(items.length - 1, pos.i + 1);
  else if (key === 'enter') { press(); return items[pos.i]?.action(); }
  else return undefined;

  tick();
  return paintDetail();
}

function closeDetail() {
  back();
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
  back();
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

/* ---------- profiles ---------- */

function showProfiles(profile) {
  const faces = $('faces');
  state.faces = profile.profiles.map((person) => {
    const el = document.createElement('div');
    el.className = 'face';
    el.dataset.focus = 'off';

    const figure = document.createElement('figure');
    if (person.avatar) {
      const img = new Image();
      img.src = person.avatar;
      img.alt = person.name;
      figure.append(img);
    } else {
      figure.textContent = person.name.slice(0, 1).toUpperCase();
    }

    const label = document.createElement('span');
    label.textContent = person.name;
    el.append(figure, label);
    faces.append(el);
    return { el, person };
  });

  faces.replaceChildren(...state.faces.map((f) => f.el));
  state.faceIndex = Math.max(0, profile.profiles.findIndex((p) => p.id === profile.active));
  paintFaces();

  reveal($('profiles'));
  body.dataset.screen = state.screen = 'profiles';
}

function paintFaces() {
  state.faces?.forEach((face, i) => {
    face.el.dataset.focus = i === state.faceIndex ? 'on' : 'off';
  });
}

async function pickProfile() {
  const chosen = state.faces?.[state.faceIndex];
  if (!chosen) return;
  thud();
  await api('/api/profile', { method: 'POST', body: JSON.stringify({ id: chosen.person.id }) })
    .catch(() => null);

  $('profiles').classList.remove('shown');
  setTimeout(() => { $('profiles').hidden = true; }, 420);

  const payload = await api('/api/home').catch(() => null);
  if (payload && !payload.error) {
    $('home').hidden = false;
    buildHome(payload);
  }
  body.dataset.screen = state.screen = 'home';
  restartTrailer();
}

function profilesKey(key) {
  const count = state.faces?.length || 0;
  if (key === 'left') state.faceIndex = Math.max(0, state.faceIndex - 1);
  else if (key === 'right') state.faceIndex = Math.min(count - 1, state.faceIndex + 1);
  else if (key === 'enter') return pickProfile();
  else return undefined;
  tick();
  return paintFaces();
}

/* ---------- player ---------- */

const player = { kind: null, item: null, yt: null, ticker: null, chromeTimer: null };
let ytApi = null;

function loadYouTubeApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });
  return ytApi;
}

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function showChrome() {
  const chrome = $('player-chrome');
  chrome.classList.add('shown');
  clearTimeout(player.chromeTimer);
  player.chromeTimer = setTimeout(() => chrome.classList.remove('shown'), 3200);
}

async function openPlayer(item) {
  stopTrailers();
  thud();

  player.kind = item.kind;
  player.item = item;
  $('player-title').textContent = item.title;
  $('scrub-fill').style.width = '0%';
  $('player-time').textContent = '';

  reveal($('player'));
  body.dataset.screen = state.screen = 'player';
  showChrome();

  if (item.kind === 'original') {
    const video = $('video');
    $('frame').replaceChildren();
    video.hidden = false;
    video.src = item.src;
    video.currentTime = item.position || 0;
    video.play().catch(() => {});
  } else {
    $('video').hidden = true;
    $('video').removeAttribute('src');
    const YT = await loadYouTubeApi();
    $('frame').replaceChildren();
    const host = document.createElement('div');
    $('frame').append(host);
    player.yt = new YT.Player(host, {
      videoId: item.id,
      playerVars: {
        autoplay: 1, controls: 0, modestbranding: 1, rel: 0,
        playsinline: 1, start: Math.floor(item.position || 0)
      },
      events: { onReady: (e) => e.target.playVideo() }
    });
  }

  clearInterval(player.ticker);
  player.ticker = setInterval(tickPlayer, 1000);
}

function playerState() {
  if (player.kind === 'original') {
    const video = $('video');
    return { position: video.currentTime || 0, duration: video.duration || 0 };
  }
  const yt = player.yt;
  if (!yt?.getCurrentTime) return { position: 0, duration: 0 };
  return { position: yt.getCurrentTime() || 0, duration: yt.getDuration() || 0 };
}

function tickPlayer() {
  const { position, duration } = playerState();
  if (duration > 0) {
    $('scrub-fill').style.width = `${Math.min(100, (position / duration) * 100)}%`;
    $('player-time').textContent = `${clock(position)} / ${clock(duration)}`;
  }
  if (position > 5) {
    api('/api/progress', {
      method: 'POST',
      body: JSON.stringify({
        key: `${player.kind}:${player.item.id}`,
        position,
        duration,
        title: player.item.title
      })
    }).catch(() => {});
  }
}

function seek(delta) {
  if (player.kind === 'original') {
    const video = $('video');
    video.currentTime = Math.max(0, (video.currentTime || 0) + delta);
  } else if (player.yt?.seekTo) {
    player.yt.seekTo(Math.max(0, (player.yt.getCurrentTime() || 0) + delta), true);
  }
  showChrome();
  tickPlayer();
}

function togglePlay() {
  if (player.kind === 'original') {
    const video = $('video');
    video.paused ? video.play().catch(() => {}) : video.pause();
  } else if (player.yt?.getPlayerState) {
    player.yt.getPlayerState() === 1 ? player.yt.pauseVideo() : player.yt.playVideo();
  }
  showChrome();
}

function playerKey(key) {
  if (key === 'space' || key === 'enter') return togglePlay();
  if (key === 'left') return seek(-10);
  if (key === 'right') return seek(10);
  if (key === 'down') return seek(-60);
  if (key === 'up') return seek(60);
  if (key === 'escape' || key === 'back') return closePlayer();
  showChrome();
  return undefined;
}

function closePlayer() {
  back();
  tickPlayer();
  clearInterval(player.ticker);
  clearTimeout(player.chromeTimer);

  const video = $('video');
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (player.yt?.destroy) player.yt.destroy();
  player.yt = null;
  $('frame').replaceChildren();

  $('player').classList.remove('shown');
  $('player-chrome').classList.remove('shown');
  setTimeout(() => { $('player').hidden = true; }, 380);

  body.dataset.screen = state.screen = 'home';
  paint();
  restartTrailer();
}

/* ---------- provider hand-off ---------- */

async function launch(providerKey, title) {
  const result = await api('/api/open', {
    method: 'POST',
    body: JSON.stringify({ providerKey, item: title })
  }).catch(() => ({ ok: false }));

  if (!result.ok) {
    return toast(result.error === 'brave-not-running'
      ? 'Uruchom system przez ikonę Gzowo TV, żeby otwierać serwisy'
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
  if (state.screen === 'detail' && state.detailSections?.[0]) {
    state.detailSections[0].items = providerActions(title, $('detail-actions'));
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

  const resuming = new URLSearchParams(location.search).has('resume');

  // Coming back from a provider is not a fresh start — no standby, no intro.
  body.dataset.screen = state.screen = resuming ? 'home' : 'standby';

  const payload = await api('/api/home').catch(() => null);

  if (!payload || payload.error) {
    $('pairing').hidden = false;
    $('pair-url').textContent = 'Serwer nie odpowiada';
    body.dataset.screen = state.screen = 'error';
    return;
  }

  $('pair-url').textContent = payload.remoteUrl;
  $('pair-small').textContent = (payload.remoteUrl || '').replace(/^https?:\/\//, '');
  $('home').hidden = false;
  buildHome(payload);

  if (resuming) {
    body.dataset.screen = state.screen = 'home';
    wake();
    return;
  }

  tell({ type: 'mode', mode: 'standby' });

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
