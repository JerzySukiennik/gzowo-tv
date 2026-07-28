// The five services the family actually pays for, plus the Apple TV Store for
// purchased titles. TMDB exposes availability but never the provider's own title
// id, so every hand-off opens the service's search pre-filled with the title.

const PROVIDERS = [
  {
    id: 8,
    key: 'netflix',
    name: 'Netflix',
    kind: 'browser',
    subscribed: true,
    search: (title) => `https://www.netflix.com/search?q=${encodeURIComponent(title)}`,
    home: 'https://www.netflix.com/browse'
  },
  {
    id: 1899,
    key: 'hbomax',
    name: 'HBO Max',
    kind: 'browser',
    subscribed: true,
    search: (title) => `https://play.max.com/search?q=${encodeURIComponent(title)}`,
    home: 'https://play.max.com'
  },
  {
    id: 337,
    key: 'disney',
    name: 'Disney+',
    kind: 'browser',
    subscribed: true,
    search: (title) => `https://www.disneyplus.com/pl-pl/search?q=${encodeURIComponent(title)}`,
    home: 'https://www.disneyplus.com/pl-pl'
  },
  {
    id: 119,
    key: 'prime',
    name: 'Prime Video',
    kind: 'browser',
    subscribed: true,
    search: (title) => `https://www.primevideo.com/search/?phrase=${encodeURIComponent(title)}`,
    home: 'https://www.primevideo.com'
  },
  {
    id: 350,
    key: 'appletv',
    name: 'Apple TV+',
    kind: 'browser',
    subscribed: true,
    search: (title) => `https://tv.apple.com/pl/search?term=${encodeURIComponent(title)}`,
    home: 'https://tv.apple.com/pl'
  },
  {
    id: 2,
    key: 'applestore',
    name: 'Moja biblioteka Apple',
    kind: 'native',
    subscribed: true,
    note: 'FairPlay — plays only in the macOS TV app',
    search: () => null,
    home: null
  }
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
const BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));

export function all() {
  return PROVIDERS.map(({ search, ...rest }) => rest);
}

export function byKey(key) {
  return BY_KEY.get(key);
}

export function subscribedIds() {
  return PROVIDERS.filter((p) => p.subscribed && p.kind === 'browser').map((p) => p.id);
}

export function launchUrl(key, title) {
  const provider = BY_KEY.get(key);
  if (!provider || provider.kind !== 'browser') return null;
  return title ? provider.search(title) : provider.home;
}

export function normalise(tmdbProviders) {
  if (!tmdbProviders) return [];
  const seen = new Map();
  for (const offer of ['flatrate', 'free', 'ads', 'rent', 'buy']) {
    for (const entry of tmdbProviders[offer] || []) {
      const known = BY_ID.get(entry.provider_id);
      if (!known) continue;
      if (seen.has(known.key)) continue;
      seen.set(known.key, {
        key: known.key,
        name: known.name,
        kind: known.kind,
        offer: offer === 'ads' || offer === 'free' ? 'flatrate' : offer,
        subscribed: known.subscribed
      });
    }
  }
  const order = { flatrate: 0, rent: 1, buy: 2 };
  return [...seen.values()].sort((a, b) => order[a.offer] - order[b.offer]);
}
