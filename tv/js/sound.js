// Audio. Interface sounds are real samples (Kenney, CC0) rather than synthesised
// blips. The boot sting stays synthesised and is voiced in G — the letter the
// whole thing is named after — because a sample cannot be trusted to land on the
// same frame as the flash, and the animation is scheduled off its impact offset.

let ctx = null;
let master = null;
let verb = null;

const SAMPLES = {
  tick: '/tv/audio/tick.m4a',
  enter: '/tv/audio/enter.m4a',
  back: '/tv/audio/back.m4a',
  open: '/tv/audio/open.m4a',
  boot: '/tv/audio/boot.m4a'
};

const buffers = new Map();

const G2 = 98.00;
const D3 = 146.83;
const G3 = 196.00;
const B3 = 246.94;
const D4 = 293.66;
const G4 = 392.00;

function build() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();

  master = ctx.createGain();
  master.gain.value = 0.75;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 12;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.22;

  master.connect(limiter).connect(ctx.destination);

  verb = ctx.createGain();
  verb.gain.value = 0.34;
  const tail = ctx.createDelay(1.2);
  tail.delayTime.value = 0.13;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2400;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.62;
  verb.connect(tail).connect(damp).connect(feedback).connect(tail);
  damp.connect(master);

  preload();
  return ctx;
}

async function preload() {
  for (const [name, url] of Object.entries(SAMPLES)) {
    if (buffers.has(name)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      // A missing sample just means that cue falls back to the synth below.
    }
  }
}

export function unlock() {
  const audio = build();
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}

export function available() {
  return Boolean(ctx) && ctx.state === 'running';
}

function sample(name, gain = 1, send = 0.18, at = 0) {
  const buffer = buffers.get(name);
  if (!buffer || !available()) return false;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(level).connect(master);

  if (send > 0) {
    const bus = ctx.createGain();
    bus.gain.value = send;
    level.connect(bus).connect(verb);
  }

  source.start(at || ctx.currentTime);
  return true;
}

function noiseBuffer(seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function voice(freq, at, { type = 'sine', peak = 0.1, attack = 0.006, decay = 2.4, send = 0.5 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);

  osc.connect(gain).connect(master);
  if (send > 0) {
    const bus = ctx.createGain();
    bus.gain.value = send;
    gain.connect(bus).connect(verb);
  }

  osc.start(at);
  osc.stop(at + decay + 0.1);
}

// Returns how many milliseconds after the call the impact lands, so the
// animation can be scheduled against the same instant.
export function bootSting(swellMs = 2000) {
  const audio = unlock();
  if (!audio) return swellMs;

  const now = audio.currentTime + 0.06;
  const hit = now + swellMs / 1000;

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(34, now);
  sub.frequency.exponentialRampToValueAtTime(49, hit);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.exponentialRampToValueAtTime(0.16, hit - 0.05);
  subGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.12);
  sub.connect(subGain).connect(master);
  sub.start(now);
  sub.stop(hit + 0.3);

  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(swellMs / 1000 + 0.4);
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = 'bandpass';
  airFilter.Q.value = 1.1;
  airFilter.frequency.setValueAtTime(320, now);
  airFilter.frequency.exponentialRampToValueAtTime(5200, hit);
  const airGain = ctx.createGain();
  airGain.gain.setValueAtTime(0.0001, now);
  airGain.gain.exponentialRampToValueAtTime(0.052, hit - 0.03);
  airGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.22);
  air.connect(airFilter).connect(airGain).connect(master);
  air.start(now);

  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(96, hit);
  thump.frequency.exponentialRampToValueAtTime(31, hit + 0.5);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.0001, hit);
  thumpGain.gain.exponentialRampToValueAtTime(0.6, hit + 0.012);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, hit + 1.5);
  thump.connect(thumpGain).connect(master);
  thump.start(hit);
  thump.stop(hit + 1.6);

  // Sampled transient on the impact frame, over the synthesised body.
  sample('boot', 0.55, 0.5, hit);

  const crack = ctx.createBufferSource();
  crack.buffer = noiseBuffer(0.3);
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.value = 3200;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.11, hit);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.19);
  crack.connect(crackFilter).connect(crackGain).connect(master);
  crackGain.connect(verb);
  crack.start(hit);

  const chord = [
    [G2, 0.000, 0.13, 'triangle'],
    [D3, 0.014, 0.10, 'triangle'],
    [G3, 0.026, 0.10, 'sine'],
    [B3, 0.052, 0.075, 'sine'],
    [D4, 0.070, 0.058, 'sine'],
    [G4, 0.104, 0.040, 'sine']
  ];

  for (const [freq, offset, peak, type] of chord) {
    voice(freq, hit + offset, { type, peak, decay: 3.1, send: 0.6 });
  }

  return swellMs;
}

function fallback(freq, peak, decay) {
  if (!available()) return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, at + decay);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

export function tick(strength = 1) {
  if (sample('tick', 0.3 * strength, 0.1)) return;
  fallback(1750, 0.028 * strength, 0.07);
}

export function thud() {
  if (sample('open', 0.42, 0.3)) return;
  fallback(220, 0.14, 0.42);
}

export function press() {
  if (sample('enter', 0.4, 0.2)) return;
  fallback(880, 0.06, 0.12);
}

export function back() {
  if (sample('back', 0.38, 0.2)) return;
  fallback(520, 0.05, 0.14);
}
