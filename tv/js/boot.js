// Boot sequence in two acts. A seam of light opens in the black and five shafts
// rise into the letter positions; everything lands on one impact frame — flash,
// shockwave, letters and chord on the same instant. Then the mark settles and the
// place it belongs to is named underneath it.

import { bootSting } from './sound.js';

const IMPACT = 2000;
const SPREAD = 9;
const HOLD = 1200;
const EXIT = 900;

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN_OUT = 'cubic-bezier(0.7, 0, 0.2, 1)';
const SNAP = 'cubic-bezier(0.2, 1.5, 0.4, 1)';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function guard(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

// Every animation here fills forwards and the sequence can now run more than
// once per page — waking from standby replays it — so anything the last run left
// behind has to be cleared first.
function reset(root) {
  for (const animation of root.getAnimations({ subtree: true })) animation.cancel();
  root.style.opacity = '';
  for (const el of root.querySelectorAll('[style]')) el.removeAttribute('style');
}

export function play(root) {
  reset(root);
  const stage = root.querySelector('.boot-stage');
  const glyphs = [...root.querySelectorAll('.glyph')];
  const seed = root.querySelector('.seed');
  const shock = root.querySelector('.shock');
  const sweep = root.querySelector('.sweep');
  const rule = root.querySelector('.rule');
  const tagline = root.querySelector('.tagline');
  const sub = root.querySelector('.sub');
  const flash = root.querySelector('.boot-flash');
  const grain = root.querySelector('.boot-grain');
  const mark = root.querySelector('.wordmark');

  bootSting(IMPACT);

  if (reduced()) return quick(root, glyphs, seed, rule, tagline);

  const settle = IMPACT + 1820;
  const total = settle + EXIT;
  const centre = (glyphs.length - 1) / 2;

  stage.animate([
    { transform: 'scale(1.08)' },
    { transform: 'scale(1.006)', offset: 0.62 },
    { transform: 'scale(1)' }
  ], { duration: total, easing: 'cubic-bezier(0.28, 0, 0.2, 1)', fill: 'forwards' });

  grain.animate([
    { opacity: 0 },
    { opacity: 0.05, offset: 0.1 },
    { opacity: 0.05, offset: 0.85 },
    { opacity: 0 }
  ], { duration: total, easing: 'linear', fill: 'forwards' });

  seed.animate([
    { transform: 'scaleX(0)', opacity: 0 },
    { transform: 'scaleX(0.14)', opacity: 0.55, offset: 0.22 },
    { transform: 'scaleX(0.42)', opacity: 1, offset: 0.5 },
    { transform: 'scaleX(1)', opacity: 0.92, offset: 0.86 },
    { transform: 'scaleX(1.06)', opacity: 0 }
  ], { duration: IMPACT + 40, easing: IN_OUT, fill: 'forwards' });

  glyphs.forEach((glyph, i) => {
    const shaft = glyph.querySelector('.shaft');
    const letter = glyph.querySelector('b');

    shaft.animate([
      { transform: 'scaleY(0)', opacity: 0 },
      { transform: 'scaleY(1)', opacity: 1, offset: 0.5 },
      { transform: 'scaleY(1)', opacity: 1, offset: 0.88 },
      { transform: 'scaleY(0.04)', opacity: 0 }
    ], { duration: 1060, delay: 900 + i * 70, easing: IN_OUT, fill: 'forwards' });

    letter.animate([
      { opacity: 0, transform: 'scale(1.22)', filter: 'blur(12px)' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
    ], { duration: 620, delay: IMPACT - 40 + i * 16, easing: SNAP, fill: 'forwards' });

    glyph.animate([
      { transform: 'translateX(0px)' },
      { transform: `translateX(${(i - centre) * SPREAD}px)` }
    ], { duration: 1500, delay: IMPACT + 60, easing: OUT, fill: 'forwards' });
  });

  flash.animate([
    { opacity: 0 },
    { opacity: 0.42, offset: 0.12 },
    { opacity: 0 }
  ], { duration: 620, delay: IMPACT - 30, easing: 'ease-out', fill: 'forwards' });

  shock.animate([
    { transform: 'scale(0.35)', opacity: 0 },
    { transform: 'scale(0.7)', opacity: 0.5, offset: 0.1 },
    { transform: 'scale(3.4)', opacity: 0 }
  ], { duration: 1000, delay: IMPACT - 20, easing: 'cubic-bezier(0.12, 0.8, 0.3, 1)', fill: 'forwards' });

  sweep.animate([
    { transform: 'translateX(-20rem) skewX(-16deg)', opacity: 0 },
    { transform: 'translateX(-8rem) skewX(-16deg)', opacity: 1, offset: 0.32 },
    { transform: 'translateX(8rem) skewX(-16deg)', opacity: 1, offset: 0.68 },
    { transform: 'translateX(20rem) skewX(-16deg)', opacity: 0 }
  ], { duration: 900, delay: IMPACT + 170, easing: IN_OUT, fill: 'forwards' });

  rule.animate([
    { transform: 'scaleX(0)' },
    { transform: 'scaleX(1)' }
  ], { duration: 760, delay: IMPACT + 640, easing: OUT, fill: 'forwards' });

  tagline.animate([
    { opacity: 0, transform: 'translateY(5px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: 760, delay: IMPACT + 940, easing: OUT, fill: 'forwards' });

  const leaving = { duration: EXIT, delay: settle, easing: IN_OUT, fill: 'forwards' };

  const exit = mark.animate([
    { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
    { opacity: 0, transform: 'scale(0.9)', filter: 'blur(16px)' }
  ], leaving);

  sub.animate([
    { opacity: 1, transform: 'translateX(-50%) scale(1)' },
    { opacity: 0, transform: 'translateX(-50%) scale(0.94)' }
  ], { ...leaving, duration: EXIT - 220 });

  const fade = root.animate([
    { opacity: 1 },
    { opacity: 0 }
  ], { duration: EXIT - 180, delay: settle + 180, easing: 'ease', fill: 'forwards' });

  const done = Promise.all([exit.finished, fade.finished]).catch(() => {});
  return guard(done, total + 300).then(() => { root.style.opacity = '0'; });
}

function quick(root, glyphs, seed, rule, tagline) {
  seed.style.opacity = '0';
  rule.style.transform = 'scaleX(1)';
  tagline.style.opacity = '1';
  glyphs.forEach((glyph) => {
    glyph.querySelector('.shaft').style.opacity = '0';
    glyph.querySelector('b').style.cssText = 'opacity:1;transform:none';
  });

  const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 500,
    delay: IMPACT + 400,
    fill: 'forwards'
  }).finished.catch(() => {});

  return guard(fade, IMPACT + 1100).then(() => { root.style.opacity = '0'; });
}
