// TMDB client. Everything is cached to disk so the catalogue survives a dead
// router, and every list is filtered to what the family can actually watch.

import { config } from './config.js';
import * as cache from './cache.js';
import { normalise, subscribedIds } from './providers.js';

const BASE = 'https://api.themoviedb.org/3';
const HOUR = 1000 * 60 * 60;

const TTL = {
  list: 6 * HOUR,
  detail: 24 * HOUR,
  search: 1 * HOUR
};

async function get(path, params = {}, ttl = TTL.list) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', config.tmdb.key);
  url.searchParams.set('language', config.tmdb.language);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const key = url.pathname + '?' + [...url.searchParams.entries()]
    .filter(([k]) => k !== 'api_key')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&');

  const fresh = cache.read(key, ttl);
  if (fresh) return fresh;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return cache.write(key, await res.json());
  } catch (err) {
    const stale = cache.readStale(key);
    if (stale) {
      console.warn('[tmdb] offline, serving cached:', key);
      return stale;
    }
    throw err;
  }
}

function card(item) {
  const type = item.media_type || (item.title ? 'movie' : 'tv');
  const title = item.title || item.name || '';
  const date = item.release_date || item.first_air_date || '';
  return {
    id: item.id,
    type,
    title,
    year: date ? Number(date.slice(0, 4)) : null,
    poster: item.poster_path || null,
    backdrop: item.backdrop_path || null,
    rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : null,
    overview: item.overview || ''
  };
}

function usable(item) {
  return item.poster_path && (item.title || item.name);
}

// Discover rows are filtered by TMDB itself, but trending and search are not.
// Keeping only titles carried on a subscription we actually pay for — rent and
// buy do not count as "we can watch this tonight".
async function onlyOnOurServices(items) {
  const checked = await Promise.all(items.map(async (item) => {
    try {
      const list = await providersFor(item.type, item.id);
      const included = list.some((p) => p.offer === 'flatrate');
      return included ? { ...item, providers: list } : null;
    } catch {
      return null;
    }
  }));
  return checked.filter(Boolean);
}

export async function row(kind, page = 1) {
  const flat = subscribedIds().join('|');
  const shared = {
    watch_region: config.tmdb.region,
    with_watch_providers: flat,
    with_watch_monetization_types: 'flatrate',
    page
  };

  switch (kind) {
    case 'trending': {
      const data = await get('/trending/all/week', { page });
      return onlyOnOurServices(data.results.filter(usable).map(card));
    }
    case 'popular-movies': {
      const data = await get('/discover/movie', { ...shared, sort_by: 'popularity.desc' });
      return data.results.filter(usable).map((i) => card({ ...i, media_type: 'movie' }));
    }
    case 'popular-tv': {
      const data = await get('/discover/tv', { ...shared, sort_by: 'popularity.desc' });
      return data.results.filter(usable).map((i) => card({ ...i, media_type: 'tv' }));
    }
    case 'new': {
      const today = new Date().toISOString().slice(0, 10);
      const ago = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10);
      const data = await get('/discover/movie', {
        ...shared,
        sort_by: 'primary_release_date.desc',
        'primary_release_date.gte': ago,
        'primary_release_date.lte': today,
        'vote_count.gte': 20
      });
      return data.results.filter(usable).map((i) => card({ ...i, media_type: 'movie' }));
    }
    case 'space': {
      const data = await get('/discover/movie', {
        ...shared,
        sort_by: 'vote_average.desc',
        with_genres: '878',
        'vote_count.gte': 500
      });
      return data.results.filter(usable).map((i) => card({ ...i, media_type: 'movie' }));
    }
    case 'docs': {
      const data = await get('/discover/movie', {
        ...shared,
        sort_by: 'popularity.desc',
        with_genres: '99'
      });
      return data.results.filter(usable).map((i) => card({ ...i, media_type: 'movie' }));
    }
    case 'family': {
      const data = await get('/discover/movie', {
        ...shared,
        sort_by: 'popularity.desc',
        with_genres: '10751'
      });
      return data.results.filter(usable).map((i) => card({ ...i, media_type: 'movie' }));
    }
    default:
      return [];
  }
}

export async function providersFor(type, id) {
  const data = await get(`/${type}/${id}/watch/providers`, {}, TTL.detail);
  return normalise(data.results?.[config.tmdb.region]);
}

export async function detail(type, id) {
  const data = await get(`/${type}/${id}`, {
    append_to_response: 'credits,videos,release_dates,content_ratings,images',
    include_image_language: 'null,en'
  }, TTL.detail);

  // TMDB's default backdrop is often a promo image with the service's logo
  // burned into it. Prefer one with no text on it at all.
  const textless = (data.images?.backdrops || [])
    .filter((b) => !b.iso_639_1 && b.width >= 1280)
    .sort((a, b) => b.vote_average - a.vote_average)[0];

  const trailer = (data.videos?.results || [])
    .filter((v) => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type))
    .sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0))[0];

  const runtime = data.runtime || data.episode_run_time?.[0] || null;

  return {
    ...card({ ...data, media_type: type }),
    backdrop: textless?.file_path || data.backdrop_path || null,
    tagline: data.tagline || '',
    runtime,
    genres: (data.genres || []).map((g) => g.name),
    cast: (data.credits?.cast || []).slice(0, 8).map((c) => ({
      name: c.name,
      character: c.character,
      photo: c.profile_path || null
    })),
    director: (data.credits?.crew || []).find((c) => c.job === 'Director')?.name || null,
    seasons: (data.seasons || [])
      .filter((s) => s.season_number > 0)
      .map((s) => ({ number: s.season_number, name: s.name, episodes: s.episode_count })),
    trailer: trailer ? trailer.key : null,
    providers: await providersFor(type, id)
  };
}

export async function season(showId, number) {
  const data = await get(`/tv/${showId}/season/${number}`, {}, TTL.detail);
  return {
    number: data.season_number,
    name: data.name,
    overview: data.overview || '',
    episodes: (data.episodes || []).map((e) => ({
      number: e.episode_number,
      title: e.name || `Odcinek ${e.episode_number}`,
      overview: e.overview || '',
      still: e.still_path || null,
      runtime: e.runtime || null,
      aired: e.air_date || null,
      rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : null
    }))
  };
}

export async function search(query) {
  if (!query || query.trim().length < 2) return [];
  const data = await get('/search/multi', { query: query.trim(), page: 1 }, TTL.search);
  const results = data.results
    .filter((r) => ['movie', 'tv'].includes(r.media_type))
    .filter(usable)
    .slice(0, 24)
    .map(card);

  return onlyOnOurServices(results);
}

export async function heroPick() {
  const candidates = await row('trending');
  const withArt = candidates.filter((c) => c.backdrop);
  if (!withArt.length) return null;
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 6));
  const chosen = withArt[day % withArt.length];
  try {
    return { ...chosen, ...(await detail(chosen.type, chosen.id)) };
  } catch {
    return chosen;
  }
}

export async function image(size, path) {
  const key = `img:${size}:${path}`;
  const cached = cache.readStale(key);
  if (cached) return Buffer.from(cached, 'base64');
  const res = await fetch(`https://image.tmdb.org/t/p/${size}${path}`, {
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  cache.write(key, buf.toString('base64'));
  return buf;
}
