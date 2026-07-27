// Boot sequence: five beams of light rise out of black, converge into the letters,
// the tracking opens up, and the wordmark recedes so the catalogue arrives behind it.

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

const TOTAL_MS = 3400;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function guard(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, ms))
  ]);
}

export function play(root) {
  const glyphs = [...root.querySelectorAll('.glyph')];
  if (reduced() || document.visibilityState === 'hidden') return quick(root, glyphs);

  const timeline = [];

  glyphs.forEach((glyph, i) => {
    const beam = glyph.querySelector('.beam');
    const letter = glyph.querySelector('b');
    const drift = (i - 2) * 74;
    const delay = i * 66;

    timeline.push(beam.animate([
      { height: '0px', opacity: 0, transform: `translateX(${drift}px) scaleY(0.2)` },
      { height: '7rem', opacity: 1, transform: `translateX(${drift * 0.55}px) scaleY(1)`, offset: 0.45 },
      { height: '7rem', opacity: 1, transform: 'translateX(0px) scaleY(1)', offset: 0.78 },
      { height: '2.2rem', opacity: 0, transform: 'translateX(0px) scaleY(0.6)' }
    ], { duration: 1350, delay, easing: EASE_IN_OUT, fill: 'forwards' }));

    timeline.push(letter.animate([
      { opacity: 0, transform: 'scale(1.14)', filter: 'blur(9px)' },
      { opacity: 0, transform: 'scale(1.14)', filter: 'blur(9px)', offset: 0.5 },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
    ], { duration: 1350, delay, easing: EASE_OUT, fill: 'forwards' }));
  });

  const mark = root.querySelector('.wordmark');

  timeline.push(mark.animate([
    { letterSpacing: '0em' },
    { letterSpacing: '0.42em' }
  ], { duration: 1100, delay: 1150, easing: EASE_OUT, fill: 'forwards' }));

  const exit = mark.animate([
    { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
    { opacity: 0, transform: 'scale(0.86)', filter: 'blur(14px)' }
  ], { duration: 900, delay: 2150, easing: EASE_IN_OUT, fill: 'forwards' });

  const fade = root.animate([
    { opacity: 1 },
    { opacity: 0 }
  ], { duration: 700, delay: 2500, easing: 'ease', fill: 'forwards' });

  const done = Promise.all([exit.finished, fade.finished]).catch(() => {});
  return guard(done, TOTAL_MS).then(() => { root.style.opacity = '0'; });
}

function quick(root, glyphs) {
  glyphs.forEach((g) => {
    g.querySelector('.beam').style.opacity = '0';
    g.querySelector('b').style.cssText = 'opacity:1;transform:none';
  });
  const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 400,
    delay: 400,
    fill: 'forwards'
  }).finished.catch(() => {});
  return guard(fade, 900).then(() => { root.style.opacity = '0'; });
}
