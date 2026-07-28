// Remote input. One swipe moves the focus exactly one step, however far the finger
// travels; a short still tap commits.

const STEP = 30;
const TAP_MS = 260;
const TAP_SLOP = 12;

const pad = document.getElementById('pad');
const ripple = document.getElementById('ripple');
const dot = document.getElementById('dot');
const status = document.getElementById('status');
const typer = document.getElementById('typer');
const field = document.getElementById('field');

let socket = null;
let live = false;

function connect() {
  socket = new WebSocket(`ws://${location.host}/ws?role=remote`);

  socket.addEventListener('open', () => {
    live = true;
    dot.dataset.live = 'on';
    status.textContent = 'Połączono';
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type !== 'state') return;
    const standby = message.mode === 'standby';
    document.body.dataset.standby = standby ? 'on' : 'off';

    if (standby) status.textContent = 'Uśpione — naciśnij zasilanie';
    else if (message.mode === 'provider') status.textContent = message.title || 'Serwis';
    else if (message.mode === 'native') status.textContent = 'Aplikacja TV';
    else status.textContent = message.tvConnected ? 'GZOWO' : 'Czekam na telewizor';
  });

  socket.addEventListener('close', () => {
    live = false;
    dot.dataset.live = 'off';
    status.textContent = 'Rozłączono';
    setTimeout(connect, 1200);
  });
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

const key = (name) => send({ type: 'key', name });

/* ---------- trackpad ---------- */

let track = null;

pad.addEventListener('pointerdown', (event) => {
  pad.setPointerCapture(event.pointerId);
  pad.classList.add('pressed', 'active');
  track = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    at: performance.now(),
    moved: 0,
    stepped: false
  };
  showRipple(event);
  send({ type: 'wake' });
});

pad.addEventListener('pointermove', (event) => {
  if (!track || event.pointerId !== track.id) return;

  const dx = event.clientX - track.startX;
  const dy = event.clientY - track.startY;
  track.moved = Math.max(track.moved, Math.abs(dx), Math.abs(dy));

  if (track.stepped) return;
  if (Math.abs(dx) < STEP && Math.abs(dy) < STEP) return;

  if (Math.abs(dx) > Math.abs(dy)) key(dx > 0 ? 'right' : 'left');
  else key(dy > 0 ? 'down' : 'up');

  track.stepped = true;
});

function release(event) {
  if (!track || event.pointerId !== track.id) return;
  const quick = performance.now() - track.at < TAP_MS;
  const still = track.moved < TAP_SLOP;
  if (!track.stepped && quick && still) key('enter');
  pad.classList.remove('pressed');
  track = null;
}

pad.addEventListener('pointerup', release);
pad.addEventListener('pointercancel', release);

function showRipple(event) {
  const box = pad.getBoundingClientRect();
  ripple.style.left = `${event.clientX - box.left}px`;
  ripple.style.top = `${event.clientY - box.top}px`;
  ripple.animate([
    { opacity: 0.9, transform: 'translate(-50%, -50%) scale(0.35)' },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' }
  ], { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}

/* ---------- buttons ---------- */

for (const button of document.querySelectorAll('.key, .power')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const name = button.dataset.key;
    const action = button.dataset.action;
    if (name) return key(name);
    if (action === 'power') return send({ type: 'power' });
    if (action === 'home') return send({ type: 'home' });
    if (action === 'keyboard') return openKeyboard();
  });
}

/* ---------- keyboard ---------- */

function openKeyboard() {
  typer.hidden = false;
  field.value = '';
  requestAnimationFrame(() => field.focus());
}

function closeKeyboard() {
  field.blur();
  typer.hidden = true;
}

field.addEventListener('input', () => send({ type: 'text', value: field.value }));

field.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    key('enter');
    closeKeyboard();
  }
});

document.getElementById('done').addEventListener('click', closeKeyboard);
typer.addEventListener('submit', (event) => event.preventDefault());

document.addEventListener('gesturestart', (event) => event.preventDefault());

connect();
