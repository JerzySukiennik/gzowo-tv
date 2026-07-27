// Pulls the dominant colour out of the artwork in focus. Images are served from
// our own origin, so the canvas stays untainted and readable.

const cache = new Map();
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
canvas.width = 20;
canvas.height = 30;

const DEFAULT = [120, 130, 150];

export function dominant(src) {
  if (!src) return Promise.resolve(DEFAULT);
  if (cache.has(src)) return Promise.resolve(cache.get(src));

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let out = DEFAULT;
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        out = extract(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      } catch {}
      cache.set(src, out);
      resolve(out);
    };
    img.onerror = () => resolve(DEFAULT);
    img.src = src;
  });
}

function extract(data) {
  let r = 0, g = 0, b = 0, weight = 0;

  for (let i = 0; i < data.length; i += 4) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const lightness = (max + min) / 510;
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255) || 1);

    if (lightness < 0.08 || lightness > 0.94) continue;

    const w = 0.35 + saturation * 1.6;
    r += R * w;
    g += G * w;
    b += B * w;
    weight += w;
  }

  if (!weight) return DEFAULT;
  return lift([r / weight, g / weight, b / weight]);
}

function lift([r, g, b]) {
  const max = Math.max(r, g, b);
  if (max < 1) return DEFAULT;
  const boost = Math.min(210 / max, 2.1);
  return [r, g, b].map((c) => Math.round(Math.min(235, c * boost)));
}
