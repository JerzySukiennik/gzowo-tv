// Boot sequence. A seam of light opens in the black and five shafts rise into the
// letter positions; everything lands on one impact frame — flash, letters and
// chord on the same instant.

import { bootSting } from './sound.js';

const IMPACT = 1300;
const SPREAD = 9;
const HOLD = 1000;
const EXIT = 820;

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN_OUT = 'cubic-bezier(0.7, 0, 0.2, 1)';
const SNAP = 'cubic-bezier(0.2, 1.5, 0.4, 1)';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function guard(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

export function play(root) {
  const stage = root.querySelector('.boot-stage');
  const glyphs = [...root.querySelectorAll('.glyph')];
  const seed = root.querySelector('.seed');
  const sweep = root.querySelector('.sweep');
  const flash = root.querySelector('.boot-flash');
  const grain = root.querySelector('.boot-grain');
  const mark = root.querySelector('.wordmark');

  bootSting(IMPACT);

  if (reduced()) return quick(root, glyphs, seed);

  const settle = IMPACT + 620 + HOLD;
  const total = settle + EXIT;

  stage.animate([
    { transform: 'scale(1.07)' },
    { transform: 'scale(1.005)', offset: 0.62 },
    { transform: 'scale(1)' }
  ], { duration: total, easing: 'cubic-bezier(0.28, 0, 0.2, 1)', fill: 'forwards' });

  grain.animate([
    { opacity: 0 },
    { opacity: 0.05, offset: 0.14 },
    { opacity: 0.05, offset: 0.82 },
    { opacity: 0 }
  ], { duration: total, easing: 'linear', fill: 'forwards' });

  seed.animate([
    { transform: 'scaleX(0)', opacity: 0 },
    { transform: 'scaleX(0.28)', opacity: 1, offset: 0.3 },
    { transform: 'scaleX(1)', opacity: 0.9, offset: 0.72 },
    { transform: 'scaleX(1.06)', opacity: 0 }
  ], { duration: IMPACT + 40, easing: IN_OUT, fill: 'forwards' });

  glyphs.forEach((glyph, i) => {
    const shaft = glyph.querySelector('.shaft');
    const letter = glyph.querySelector('b');

    shaft.animate([
      { transform: 'scaleY(0)', opacity: 0 },
      { transform: 'scaleY(1)', opacity: 1, offset: 0.55 },
      { transform: 'scaleY(1)', opacity: 1, offset: 0.86 },
      { transform: 'scaleY(0.04)', opacity: 0 }
    ], { duration: IMPACT - 340, delay: 620 + i * 52, easing: IN_OUT, fill: 'forwards' });

    letter.animate([
      { opacity: 0, transform: 'scale(1.22)', filter: 'blur(12px)' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
    ], { duration: 620, delay: IMPACT - 40 + i * 16, easing: SNAP, fill: 'forwards' });

    glyph.animate([
      { transform: 'translateX(0px)' },
      { transform: `translateX(${(i - 2) * SPREAD}px)` }
    ], { duration: 1500, delay: IMPACT + 60, easing: OUT, fill: 'forwards' });
  });

  flash.animate([
    { opacity: 0 },
    { opacity: 0.42, offset: 0.12 },
    { opacity: 0 }
  ], { duration: 620, delay: IMPACT - 30, easing: 'ease-out', fill: 'forwards' });

  sweep.animate([
    { transform: 'translateX(-20rem) skewX(-16deg)', opacity: 0 },
    { transform: 'translateX(-8rem) skewX(-16deg)', opacity: 1, offset: 0.32 },
    { transform: 'translateX(8rem) skewX(-16deg)', opacity: 1, offset: 0.68 },
    { transform: 'translateX(20rem) skewX(-16deg)', opacity: 0 }
  ], { duration: 900, delay: IMPACT + 170, easing: IN_OUT, fill: 'forwards' });

  const exit = mark.animate([
    { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
    { opacity: 0, transform: 'scale(0.9)', filter: 'blur(16px)' }
  ], { duration: EXIT, delay: settle, easing: IN_OUT, fill: 'forwards' });

  const fade = root.animate([
    { opacity: 1 },
    { opacity: 0 }
  ], { duration: EXIT - 180, delay: settle + 180, easing: 'ease', fill: 'forwards' });

  const done = Promise.all([exit.finished, fade.finished]).catch(() => {});
  return guard(done, total + 300).then(() => { root.style.opacity = '0'; });
}

function quick(root, glyphs, seed) {
  seed.style.opacity = '0';
  glyphs.forEach((glyph) => {
    glyph.querySelector('.shaft').style.opacity = '0';
    glyph.querySelector('b').style.cssText = 'opacity:1;transform:none';
  });

  const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 500,
    delay: IMPACT + 200,
    fill: 'forwards'
  }).finished.catch(() => {});

  return guard(fade, IMPACT + 900).then(() => { root.style.opacity = '0'; });
}
