// Remote input. A drag is quantised into focus steps so it feels like the Apple TV
// trackpad rather than a mouse, and a short still tap commits.

const STEP = 34;
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
    if (message.mode === 'provider') status.textContent = message.title || 'Serwis';
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
    lastX: event.clientX,
    lastY: event.clientY,
    at: performance.now(),
    moved: 0,
    axis: null
  };
  showRipple(event);
  send({ type: 'wake' });
});

pad.addEventListener('pointermove', (event) => {
  if (!track || event.pointerId !== track.id) return;

  const dx = event.clientX - track.lastX;
  const dy = event.clientY - track.lastY;
  track.moved += Math.abs(dx) + Math.abs(dy);

  if (!track.axis && Math.abs(event.clientX - track.startX) + Math.abs(event.clientY - track.startY) > TAP_SLOP) {
    track.axis = Math.abs(event.clientX - track.startX) > Math.abs(event.clientY - track.startY) ? 'x' : 'y';
  }

  if (track.axis === 'x' && Math.abs(dx) >= STEP) {
    key(dx > 0 ? 'right' : 'left');
    track.lastX = event.clientX;
    track.lastY = event.clientY;
  } else if (track.axis === 'y' && Math.abs(dy) >= STEP) {
    key(dy > 0 ? 'down' : 'up');
    track.lastX = event.clientX;
    track.lastY = event.clientY;
  }
});

function release(event) {
  if (!track || event.pointerId !== track.id) return;
  const quick = performance.now() - track.at < TAP_MS;
  const still = track.moved < TAP_SLOP;
  if (quick && still) key('enter');
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

for (const button of document.querySelectorAll('.key')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const name = button.dataset.key;
    const action = button.dataset.action;
    if (name) return key(name);
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
