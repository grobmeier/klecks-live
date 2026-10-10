import { decodeFrame, VERSION } from './protocol.js';
const canvas = document.getElementById('drawing'), context = canvas.getContext('2d');
const status = document.getElementById('status'), message = document.getElementById('message'), indicator = document.getElementById('indicator');
const id = location.pathname.split('/').pop(), token = location.hash.slice(1);
const config = await fetch('/api/config', { cache: 'no-store' }).then(response => response.json());
let socket, epoch, lastSequence = 0, generation = 0, busy = false, pending, terminal = false, retry = 500, retryTimer, relayState = 'waiting', hasFreshFrame = false;
const setState = (text, detail, live = false, clear = false) => {
  status.textContent = text; indicator.classList.toggle('live', live);
  message.textContent = detail || ''; message.hidden = !detail;
  if (clear) { canvas.hidden = true; canvas.width = 1; canvas.height = 1; generation++; pending = undefined; hasFreshFrame = false; }
};
async function render() {
  if (busy || !pending || terminal) return;
  busy = true;
  const data = pending; pending = undefined; const version = generation;
  let url;
  try {
    const { header, image } = decodeFrame(data, config.maxFrameBytes, config.maxEdge);
    if (header.epoch !== epoch || header.seq <= lastSequence) return;
    const blob = new Blob([image], { type: header.mime }); url = URL.createObjectURL(blob);
    const img = new Image(); img.src = url; await img.decode();
    // Paint the newest completed decode, then decode the latest pending view.
    // Discarding completed images while updates arrive can starve the display.
    if (terminal || version !== generation) return;
    canvas.width = header.width; canvas.height = header.height; context.drawImage(img, 0, 0);
    lastSequence = header.seq; canvas.dataset.sequence = String(lastSequence); canvas.hidden = false;
    hasFreshFrame = true;
    if (relayState === 'live') setState('Live', '', true);
  } catch { setState('Reconnecting', 'Waiting for a readable drawing update.'); }
  finally { if (url) URL.revokeObjectURL(url); busy = false; if (pending) void render(); }
}
function connect() {
  if (terminal) return;
  generation++; pending = undefined; hasFreshFrame = false; lastSequence = 0;
  socket = new WebSocket(new URL('/socket', location.origin).href.replace(/^http/, 'ws')); socket.binaryType = 'arraybuffer';
  const current = socket;
  current.addEventListener('open', () => current.send(JSON.stringify({ type: 'auth', v: VERSION, role: 'viewer', id, token })));
  current.addEventListener('message', event => {
    if (current !== socket || terminal) return;
    if (typeof event.data !== 'string') { pending = event.data; void render(); return; }
    const data = JSON.parse(event.data);
    if (data.type === 'ended') { terminal = true; setState('Session ended', 'The presenter has ended sharing or the session has expired.', false, true); return; }
    if (data.type === 'unavailable') { terminal = true; setState('Capacity reached', 'This session has reached its viewer limit.', false, true); return; }
    if (['ready', 'status'].includes(data.type)) {
      relayState = data.state;
      if (epoch !== data.epoch) { epoch = data.epoch; lastSequence = 0; generation++; pending = undefined; hasFreshFrame = false; }
      retry = 500;
      if (data.state === 'live') setState(hasFreshFrame ? 'Live' : 'Waiting for the presenter', hasFreshFrame ? '' : 'Waiting for a fresh drawing update.', hasFreshFrame);
      else if (data.state === 'paused') setState('Presenter paused', 'The presenter is paused or reconnecting. This is the last received view.');
      else setState('Waiting for the presenter', 'Waiting for a fresh drawing update.', false, true);
    }
  });
  current.addEventListener('close', event => {
    if (terminal || current !== socket) return;
    generation++; pending = undefined; hasFreshFrame = false; relayState = 'waiting';
    if (event.code === 1008) { terminal = true; setState('Session unavailable', 'Check the viewer link or ask the presenter for a new one.', false, true); return; }
    setState('Reconnecting', 'Connection lost. Waiting to rejoin the session.');
    retryTimer = setTimeout(connect, retry); retry = Math.min(10000, retry * 2);
  });
  current.addEventListener('error', () => {});
}
document.getElementById('fullscreen').addEventListener('click', () => {
  document.documentElement.requestFullscreen?.().catch(() => {});
});
if (!token) { terminal = true; setState('Session unavailable', 'Open the complete viewer link supplied by the presenter.', false, true); } else connect();
window.addEventListener('pagehide', () => { terminal = true; clearTimeout(retryTimer); socket?.close(); });
