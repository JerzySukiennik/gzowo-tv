// YouTube rows. The daily quota is 10,000 units and a search costs 100 of them,
// so searching is a last resort: trending and channel uploads cost one unit each,
// and live streams are found inside the uploads feed rather than with a live
// search, which would cost a hundred every time.

import { config } from './config.js';
import * as cache from './cache.js';

const BASE = 'https://www.googleapis.com/youtube/v3';
const MINUTE = 60 * 1000;

const TTL = {
  trending: 90 * MINUTE,
  uploads: 45 * MINUTE,
  live: 12 * MINUTE,
  search: 120 * MINUTE
};

export const CHANNELS = [
  { key: 'mrbeast', title: 'MrBeast', id: 'UCX6OQ3DkcsbYNE6H8uQQuVA', uploads: 'UUX6OQ3DkcsbYNE6H8uQQuVA', rocket: false },
  { key: 'nasa', title: 'NASA', id: 'UCLA_DiR1FfKNvjuUpBHmylQ', uploads: 'UULA_DiR1FfKNvjuUpBHmylQ', rocket: true },
  { key: 'spacex', title: 'SpaceX', id: 'UCtI0Hodo5o5dUb67FeUjDeA', uploads: 'UUtI0Hodo5o5dUb67FeUjDeA', rocket: true }
];

function enabled() {
  return Boolean(config.youtubeKey);
}

async function get(path, params, ttl) {
  const url = new URL(BASE + path);
  url.searchParams.set('key', config.youtubeKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const key = 'yt:' + url.pathname + '?' + [...url.searchParams.entries()]
    .filter(([k]) => k !== 'key')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&');

  const fresh = cache.read(key, ttl);
  if (fresh) return fresh;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error(`YouTube ${res.status}`);
    return cache.write(key, await res.json());
  } catch (err) {
    const stale = cache.readStale(key);
    if (stale) {
      console.warn('[youtube] serving cached:', key);
      return stale;
    }
    throw err;
  }
}

function seconds(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function card(video, extra = {}) {
  const snippet = video.snippet || {};
  const thumbs = snippet.thumbnails || {};
  const best = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default;
  return {
    kind: 'youtube',
    id: video.id?.videoId || video.id || snippet.resourceId?.videoId,
    title: snippet.title || '',
    channel: snippet.channelTitle || '',
    thumb: best?.url || null,
    published: snippet.publishedAt || null,
    duration: seconds(video.contentDetails?.duration),
    live: video.snippet?.liveBroadcastContent === 'live',
    ...extra
  };
}

function usable(item) {
  return item.id && item.title && item.thumb && item.title !== 'Private video';
}

export async function trending(regionCode = 'US') {
  if (!enabled()) return [];
  const data = await get('/videos', {
    part: 'snippet,contentDetails',
    chart: 'mostPopular',
    maxResults: 25,
    regionCode
  }, TTL.trending);
  return (data.items || []).map((v) => card(v)).filter(usable);
}

export async function uploads(channel, limit = 25) {
  if (!enabled()) return [];
  const list = await get('/playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: channel.uploads,
    maxResults: limit
  }, TTL.uploads);

  const ids = (list.items || [])
    .map((i) => i.contentDetails?.videoId)
    .filter(Boolean)
    .slice(0, limit);

  if (!ids.length) return [];

  const details = await get('/videos', {
    part: 'snippet,contentDetails',
    id: ids.join(',')
  }, TTL.uploads);

  return (details.items || []).map((v) => card(v, { channelKey: channel.key })).filter(usable);
}

// Live streams show up in a channel's uploads feed while they are running, so
// they can be found for one unit instead of the hundred a live search costs.
export async function live() {
  if (!enabled()) return [];
  const rockets = CHANNELS.filter((c) => c.rocket);
  const found = [];

  for (const channel of rockets) {
    try {
      const list = await get('/playlistItems', {
        part: 'contentDetails',
        playlistId: channel.uploads,
        maxResults: 6
      }, TTL.live);

      const ids = (list.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
      if (!ids.length) continue;

      const details = await get('/videos', {
        part: 'snippet,contentDetails,liveStreamingDetails',
        id: ids.join(',')
      }, TTL.live);

      for (const video of details.items || []) {
        const state = video.snippet?.liveBroadcastContent;
        if (state === 'live' || state === 'upcoming') {
          found.push(card(video, {
            channelKey: channel.key,
            live: state === 'live',
            upcoming: state === 'upcoming',
            startsAt: video.liveStreamingDetails?.scheduledStartTime || null
          }));
        }
      }
    } catch (err) {
      console.warn('[youtube] live check failed for', channel.key, err.message);
    }
  }

  return found.filter(usable);
}

export async function search(query) {
  if (!enabled() || !query || query.trim().length < 2) return [];
  const found = await get('/search', {
    part: 'snippet',
    q: query.trim(),
    type: 'video',
    maxResults: 12,
    safeSearch: 'moderate'
  }, TTL.search);

  const ids = (found.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];

  const details = await get('/videos', {
    part: 'snippet,contentDetails',
    id: ids.join(',')
  }, TTL.search);

  return (details.items || []).map((v) => card(v)).filter(usable);
}

export async function rows() {
  if (!enabled()) return [];
  const out = [];

  const [liveNow, popular] = await Promise.all([
    live().catch(() => []),
    trending().catch(() => [])
  ]);

  if (liveNow.length) out.push({ key: 'yt-live', title: 'Na żywo', wide: true, items: liveNow });

  for (const channel of CHANNELS) {
    const items = await uploads(channel).catch(() => []);
    if (items.length) {
      out.push({ key: `yt-${channel.key}`, title: channel.title, wide: true, items });
    }
  }

  if (popular.length) out.push({ key: 'yt-trending', title: 'Popularne na YouTube', wide: true, items: popular });

  return out;
}
